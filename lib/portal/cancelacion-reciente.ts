/**
 * Rastro de una cancelación hecha desde el portal (25/9/2026).
 *
 * ── Por qué hace falta ─────────────────────────────────────────────────────
 *
 * Los botones del recordatorio siguen tocables para siempre. El paciente
 * cancela desde el portal y después, en el mismo mensaje de WhatsApp, toca
 * "Confirmar asistencia" o "Reprogramar turno". El turno ya no existe.
 *
 * Al cancelar se borra el contexto del turno (`clearAppointmentContext`), así
 * que el bot se queda sin nada que decir y contestaba "Hubo un problema al
 * confirmar tu turno, intentá de nuevo en unos momentos" — un callejón sin
 * salida: por más que reintente, el turno no va a volver.
 *
 * El problema de fondo es el de siempre: "no tengo el contexto" y "falló el
 * sistema" son cosas distintas y compartían mensaje. Esto deja registrado el
 * hecho, para poder decir lo que realmente pasó.
 *
 * ── Siete días ────────────────────────────────────────────────────────────
 *
 * Alcanza y sobra: el recordatorio se manda uno o dos días antes del turno, y
 * después de una semana el mensaje ya quedó enterrado en el chat. Un TTL
 * eterno sería acumular basura para responder algo que nadie va a preguntar.
 */

import { getRedisClient } from "../redis"

const PREFIJO = "portal:cancelado:"
const TTL_SEGUNDOS = 7 * 24 * 60 * 60

export interface CancelacionReciente {
  /** Fecha del turno cancelado, como la tenía el contexto. */
  fecha?: string
  /** "26/09/2026 a las 05:20", ya listo para mostrar. */
  cuando?: string
  /** ISO del momento en que se canceló. */
  cuandoSeCancelo: string
}

function clave(configId: string, phone: string): string {
  return `${PREFIJO}${configId}:${phone}`
}

/**
 * Deja el rastro. Best-effort: si falla, el paciente recibe el mensaje genérico
 * de siempre, que es peor pero no rompe nada.
 */
export async function marcarCancelacion(
  configId: string,
  phone: string,
  datos: { fecha?: string; cuando?: string },
): Promise<void> {
  try {
    const redis = getRedisClient()
    if (!redis) return

    const registro: CancelacionReciente = {
      fecha: datos.fecha,
      cuando: datos.cuando,
      cuandoSeCancelo: new Date().toISOString(),
    }

    await redis.setex(clave(configId, phone), TTL_SEGUNDOS, JSON.stringify(registro))
  } catch (error) {
    console.error("[PORTAL] No se pudo registrar la cancelación:", error)
  }
}

/** `null` cuando no hay rastro. NO significa que no se haya cancelado nunca. */
export async function cancelacionReciente(
  configId: string,
  phone: string,
): Promise<CancelacionReciente | null> {
  try {
    const redis = getRedisClient()
    if (!redis) return null

    const crudo = await redis.get(clave(configId, phone))
    if (!crudo) return null

    return typeof crudo === "string" ? JSON.parse(crudo) : (crudo as CancelacionReciente)
  } catch (error) {
    console.error("[PORTAL] No se pudo leer el rastro de cancelación:", error)
    return null
  }
}

/**
 * Lo que se le dice a quien toca "Confirmar asistencia" después de cancelar.
 *
 * Sin "intentá de nuevo": no hay nada que reintentar. Y con la salida a mano,
 * porque quien llega acá probablemente quiera un turno.
 */
export function mensajeYaCancelado(cancelacion: CancelacionReciente): string {
  const cuando = cancelacion.cuando ? ` del ${cancelacion.cuando}` : ""
  return (
    `Tu turno${cuando} ya fue cancelado, así que no hay nada que confirmar.\n\n` +
    `Si querés sacar uno nuevo, escribime "quiero un turno" y te ayudo.`
  )
}

/** Se borra cuando el paciente vuelve a tener un turno: el rastro ya no aplica. */
export async function olvidarCancelacion(configId: string, phone: string): Promise<void> {
  try {
    const redis = getRedisClient()
    if (!redis) return
    await redis.del(clave(configId, phone))
  } catch {
    // Best-effort: un rastro que sobrevive de más sólo cambia un mensaje.
  }
}
