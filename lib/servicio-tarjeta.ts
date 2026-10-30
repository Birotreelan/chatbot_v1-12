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
  /** La percepción que la tarjeta devuelve. Se guarda sólo para poder mostrarla. */
  excluidoARS: number
  /** El detalle, para poder auditar un número meses después. */
  lineas: LineaDelResumen[]
  impuestos: ImpuestoDelResumen[]
  cargadoEl: string
  nota?: string
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
