/**
 * Los resúmenes de tarjeta cargados (30/10/2026).
 *
 * ── Uno por fecha de cierre ────────────────────────────────────────────────
 *
 * La clave es la fecha de cierre, así que cargar dos veces el mismo resumen
 * reemplaza en vez de duplicar. Es la propiedad que más importa de todo este
 * módulo: un resumen contado dos veces mete una diferencia en la cuenta
 * corriente que después nadie puede explicar, y la cuenta corriente es
 * justamente lo que tiene que cerrar al centavo.
 *
 * ── A qué mes se imputa ────────────────────────────────────────────────────
 *
 * El período de la tarjeta es móvil: este resumen cierra el 01-Oct y abarca del
 * 29-Ago al 01-Oct, o sea casi todo septiembre. Nunca va a coincidir con un mes
 * calendario, así que imputar "por fecha de cargo" sería falsa precisión —
 * encima Meta cobra por umbral, y un cargo del 1-Oct puede ser consumo de
 * septiembre.
 *
 * Entonces el resumen entero se imputa a UN mes, que por default es el del
 * cierre y se puede cambiar a mano. La diferencia contra lo computado ese mes
 * queda como saldo y se arrastra. Mes a mes no cuadra; el acumulado sí, al
 * centavo. Ver lib/servicio-conciliacion.ts.
 */

import { getRedisClient } from "./redis"
import type { ImpuestoDelResumen, LineaDelResumen } from "./tarjeta-resumen"

const PREFIJO = "servicio:tarjeta:resumen:"
const INDICE = "servicio:tarjeta:cierres"

/**
 * El PDF, en una clave SEPARATE del resumen (2/11/2026).
 *
 * Separada a propósito: `listarResumenes` lee todos los resúmenes para armar la
 * cuenta corriente, y si el archivo viviera en la misma clave cada carga de la
 * pantalla se traería todos los PDF en base64 para no mostrar ninguno. Acá se
 * lee sólo cuando alguien lo pide.
 */
const PREFIJO_PDF = "servicio:tarjeta:pdf:"

/**
 * Hasta cuánto se guarda. Estos resúmenes son de 250 a 350 KB; 4 MB es margen
 * de sobra y a la vez un techo: en base64 un archivo ocupa un 33 % más, y
 * Redis no es un depósito de archivos.
 */
export const MAXIMO_PDF_GUARDADO_BYTES = 4 * 1024 * 1024

export interface ResumenGuardado {
  /** La fecha de cierre, ISO. Es la identidad del resumen. */
  cierre: string
  cierreAnterior: string | null
  vencimiento: string | null
  /** El mes al que se imputa, "YYYY-MM". */
  periodoImputado: string
  /** El dólar del resumen, con el que el banco calculó los impuestos. */
  tipoDeCambio: number | null
  /** Lo que Meta cobró, neto de impuestos. Es lo que se concilia. */
  cargosDeMetaUSD: number
  /** Vercel, OpenAI, Upstash: costo fijo, no por mensaje. */
  cargosFijosUSD: number
  impuestosARS: number
  impuestosUSD: number
  /**
   * La percepción RG 5617, en sus dos movimientos y no sumados: el débito de
   * este período y el crédito del anterior. No se computan en ningún total;
   * se guardan para poder mostrar el resumen completo.
   */
  percepcionDebitadaARS: number
  percepcionAcreditadaARS: number
  /** El detalle, para poder auditar un número meses después. */
  lineas: LineaDelResumen[]
  impuestos: ImpuestoDelResumen[]
  cargadoEl: string
  nota?: string
  /**
   * El comprobante guardado, si entró. Son los datos para mostrarlo y
   * ofrecerlo; el contenido vive en su propia clave.
   *
   * Que esté es lo que convierte la conciliación en algo auditable: tres meses
   * después, "¿de dónde salió este US$ 1.691,98?" se contesta abriendo el
   * papel, no reconstruyendo la cuenta.
   */
  pdf?: {
    nombre: string
    bytes: number
    guardadoEl: string
  }
}

/** Guarda el PDF del resumen. Devuelve `false` si era demasiado grande. */
export async function guardarPDFDelResumen(cierre: string, pdf: Buffer): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) throw new Error("Redis no está disponible")
  if (pdf.length === 0 || pdf.length > MAXIMO_PDF_GUARDADO_BYTES) return false

  // Sin TTL: es el respaldo de un registro contable y no vence.
  await redis.set(`${PREFIJO_PDF}${cierre}`, pdf.toString("base64"))
  return true
}

/** El PDF guardado de ese cierre, o `null`. */
export async function leerPDFDelResumen(cierre: string): Promise<Buffer | null> {
  const redis = getRedisClient()
  if (!redis) return null

  try {
    const crudo = await redis.get(`${PREFIJO_PDF}${cierre}`)
    if (!crudo || typeof crudo !== "string") return null
    return Buffer.from(crudo, "base64")
  } catch (error) {
    console.error(`[SERVICIO_TARJETA] No se pudo leer el PDF de ${cierre}:`, error)
    return null
  }
}

/** "2026-10-01" → "2026-10" */
export function periodoDelCierre(cierre: string): string {
  return String(cierre).slice(0, 7)
}

export async function guardarResumen(resumen: ResumenGuardado): Promise<void> {
  const redis = getRedisClient()
  if (!redis) throw new Error("Redis no está disponible")

  await redis.set(`${PREFIJO}${resumen.cierre}`, JSON.stringify(resumen))
  await redis.sadd(INDICE, resumen.cierre)
}

export async function borrarResumen(cierre: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) throw new Error("Redis no está disponible")

  await redis.del(`${PREFIJO}${cierre}`)
  // El archivo se va con el resumen: dejarlo sería ocupar lugar con un
  // comprobante que ya no está referenciado por nada.
  await redis.del(`${PREFIJO_PDF}${cierre}`)
  await redis.srem(INDICE, cierre)
}

/**
 * Todos los resúmenes cargados, del más viejo al más nuevo.
 *
 * Se devuelven TODOS y no los de un mes: el saldo de la cuenta corriente es
 * acumulado, así que para saber el de octubre hay que haber recorrido todo lo
 * anterior. Filtrar acá sería arrastrar un saldo incompleto.
 */
export async function listarResumenes(): Promise<ResumenGuardado[]> {
  const redis = getRedisClient()
  if (!redis) return []

  let cierres: string[] = []
  try {
    cierres = (await redis.smembers(INDICE)) || []
  } catch (error) {
    console.error("[SERVICIO_TARJETA] No se pudo leer el índice:", error)
    return []
  }
  if (cierres.length === 0) return []

  const crudos = await Promise.all(cierres.map((c) => redis.get(`${PREFIJO}${c}`)))

  const resumenes: ResumenGuardado[] = []
  crudos.forEach((crudo, i) => {
    if (!crudo) {
      // El índice quedó con un cierre cuyo valor no está. Se avisa y se sigue:
      // perder un resumen es grave, pero esconderlo es peor.
      console.warn(`[SERVICIO_TARJETA] El índice tiene ${cierres[i]} pero no hay datos guardados`)
      return
    }
    try {
      // Upstash deserializa solo los valores que parecen JSON, así que puede
      // venir ya como objeto o como string. Las dos formas son válidas.
      const datos = typeof crudo === "string" ? JSON.parse(crudo) : crudo
      if (datos?.cierre) resumenes.push(datos as ResumenGuardado)
    } catch (error) {
      console.error(`[SERVICIO_TARJETA] No se pudo leer el resumen ${cierres[i]}:`, error)
    }
  })

  return resumenes.sort((a, b) => a.cierre.localeCompare(b.cierre))
}
