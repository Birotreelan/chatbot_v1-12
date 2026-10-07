/**
 * El cierre de un mes facturado: lo que se cobró, congelado (7/10/2026).
 *
 * ── El problema ────────────────────────────────────────────────────────────
 *
 * Facturación no guardaba nada. Cada vez que se abría un mes, el total se
 * recalculaba de cero: se consultaba el proxy por ese rango, se le aplicaba el
 * `precio_unidad` ACTUAL y se multiplicaba por el dólar DE HOY.
 *
 * O sea que un mes ya facturado cambiaba solo. Abrir septiembre dos días
 * seguidos daba dos totales distintos, porque el dólar se movió. Subirle el
 * precio a un cliente reescribía su historia entera. Y cualquier cambio de la
 * lógica de cálculo —como el de octubre— se aplicaba retroactivamente a todo.
 *
 * Nada de eso se arregla "no tocando el código": el número no estaba guardado
 * en ninguna parte, así que no había nada que preservar.
 *
 * ── Qué hace ───────────────────────────────────────────────────────────────
 *
 * La primera vez que se mira un mes YA TERMINADO, se calcula y se guarda el
 * cierre completo: las unidades, el precio unitario, el dólar de ese momento y
 * el total. De ahí en adelante el panel lee ese cierre y no vuelve a calcular.
 *
 * El mes en curso nunca se congela: está pasando, y tiene que seguir
 * moviéndose.
 *
 * ── Por qué se guarda el precio y el dólar, y no sólo el total ─────────────
 *
 * Porque un total sin su desglose no se puede defender. Cuando el cliente
 * pregunta por qué le facturamos eso, la respuesta tiene que ser "1.320
 * unidades a US$ 0,13 con el dólar a $1.465", no un número suelto. Guardar las
 * tres partes es lo que hace auditable el cierre meses después, cuando el
 * precio y el dólar ya son otros.
 */

import { getRedisClient } from "./redis"
import { idDeLaReglaDelPeriodo, type ReglaDeCalculo } from "./facturacion-reglas"

export { idDeLaReglaDelPeriodo as reglaDelPeriodo }
export type { ReglaDeCalculo }

const PREFIJO = "facturacion:cierre:"

/**
 * La regla con la que se cerró el mes queda escrita en el cierre a propósito:
 * dentro de un año, mirando un mes viejo, es lo que explica por qué ese total
 * no se puede reproducir con el código de entonces.
 *
 * El tipo y el corte por fecha viven en lib/facturacion-reglas.ts, que es el
 * único lugar donde se declaran las reglas y sus vigencias.
 */
export interface CierreDeMes {
  /** "2026-09" */
  periodo: string
  /** Unidades cobradas, ya con la regla del período aplicada. */
  unidades: number
  /** El precio por unidad vigente al cerrar. `null` si no estaba cargado. */
  precioUnitarioUsd: number | null
  /** La cotización usada. `null` si la API no respondió al cerrar. */
  dolarVenta: number | null
  regla: ReglaDeCalculo
  cerradoEl: string
  /**
   * El reparto por sede, cuando la clínica tiene varias.
   *
   * Hace falta guardarlo: la factura es por sede, y los porcentajes salen de
   * un endpoint que consulta por rango de fechas y puede cambiar. Sin esto, un
   * mes congelado de una clínica con sedes volvería como una sola fila con el
   * total, y el desglose que se facturó se perdería.
   */
  sedes?: Array<{ nombre: string; interacciones: number }>
}

function clave(clienteId: string, periodo: string): string {
  return `${PREFIJO}${clienteId}:${periodo}`
}

/** "2026-09" a partir de la fecha de inicio del rango. */
export function periodoDe(fechaInicio: string): string {
  return (fechaInicio || "").slice(0, 7)
}

/**
 * ¿Este mes ya terminó?
 *
 * Sólo los meses terminados se congelan. Se compara contra el mes calendario
 * actual en hora local, que es la misma referencia que usa el selector del
 * panel: si usara UTC, durante las primeras horas del día 1 el panel diría "mes
 * en curso" y esto diría "ya terminó", y el mes se congelaría incompleto.
 */
export function mesTerminado(periodo: string, ahora: Date = new Date()): boolean {
  const actual = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}`
  return periodo < actual
}

export async function leerCierre(clienteId: string, periodo: string): Promise<CierreDeMes | null> {
  const redis = getRedisClient()
  if (!redis || !clienteId || !periodo) return null

  try {
    const crudo = await redis.get(clave(clienteId, periodo))
    if (!crudo) return null
    const datos = typeof crudo === "string" ? JSON.parse(crudo) : (crudo as any)
    return datos && typeof datos === "object" ? (datos as CierreDeMes) : null
  } catch (error) {
    console.warn("[FACTURACION_CIERRE] No se pudo leer el cierre:", error)
    return null
  }
}

/**
 * Guarda el cierre, sin pisar uno existente.
 *
 * El `if` no es defensivo por las dudas: dos pestañas abiertas sobre el mismo
 * mes llegan acá a la vez, y la segunda traería otro dólar. Sin esta guarda, el
 * cierre quedaría definido por cuál de las dos terminó última.
 */
export async function guardarCierre(clienteId: string, cierre: CierreDeMes): Promise<void> {
  const redis = getRedisClient()
  if (!redis || !clienteId) return

  try {
    const k = clave(clienteId, cierre.periodo)
    const yaEsta = await redis.get(k)
    if (yaEsta) return

    // Sin TTL: un cierre es un registro contable y no vence.
    await redis.set(k, JSON.stringify(cierre))
    console.log(`[FACTURACION_CIERRE] ${clienteId} ${cierre.periodo} cerrado (${cierre.regla})`)
  } catch (error) {
    console.warn("[FACTURACION_CIERRE] No se pudo guardar el cierre:", error)
  }
}

/**
 * Borra el cierre de un mes para que se recalcule.
 *
 * Hace falta por una razón concreta: si el proxy tenía datos incompletos el día
 * que alguien abrió el panel, ese error queda congelado. Poder reabrir el mes
 * es la diferencia entre corregirlo y tener que editar Redis a mano.
 *
 * Es una operación delicada —reabre un mes ya facturado— y por eso vive en una
 * función con nombre propio y no como un parámetro de las de arriba.
 */
export async function reabrirMes(clienteId: string, periodo: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  try {
    await redis.del(clave(clienteId, periodo))
    console.log(`[FACTURACION_CIERRE] ${clienteId} ${periodo} reabierto`)
  } catch (error) {
    console.warn("[FACTURACION_CIERRE] No se pudo reabrir:", error)
  }
}
