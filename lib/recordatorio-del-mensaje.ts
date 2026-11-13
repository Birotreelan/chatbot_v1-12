/**
 * El recordatorio que el paciente tocó (13/11/2026).
 *
 * ── El caso que esto arregla ───────────────────────────────────────────────
 *
 * Reportado: a Rosana (DNI 16715916) le llegaron dos recordatorios y al tocar
 * "Confirmar" se confirmó el DNI 20755823 —otra persona— y el proxy contestó
 * "No se encontraron turnos para el paciente en la fecha especificada". Ella
 * recibió "no encontramos un turno a tu nombre" y su turno quedó sin
 * confirmar.
 *
 * Por qué: el botón no confirmaba el turno del mensaje tocado. Confirmaba lo
 * que hubiera en `appointment_context:<configId>:<telefono>`, UNA clave por
 * teléfono, que cualquier flujo puede sobrescribir —entre ellos
 * `rebuildAppointmentContextFromBackend`, que busca al paciente POR TELÉFONO
 * en la tabla `pacientes` y adopta el que encuentra—.
 *
 * Y eso no es un caso raro, es el caso normal: un teléfono es de una familia.
 * Una madre saca turno para ella y para dos hijos; alguien saca uno para un
 * conocido. Peor todavía, los datos del recordatorio salen de `agenda` y el
 * paciente puede no existir en `pacientes` si nunca se atendió, así que la
 * búsqueda por teléfono devuelve al familiar que sí está, con cara de
 * respuesta correcta.
 *
 * ── La regla ───────────────────────────────────────────────────────────────
 *
 * El turno que llegó es el que se confirma. Cuando se manda un recordatorio se
 * guarda su `Chatbot_Data` bajo el id del mensaje de WhatsApp (`wamid`), y
 * cuando el paciente toca un botón, WhatsApp dice en `context.id` a qué
 * mensaje está respondiendo. Con eso el botón del recordatorio de las 17:45
 * confirma el turno de las 17:45, pase lo que pase con el contexto del
 * teléfono y aunque hayan llegado cuatro recordatorios después.
 *
 * ── Por qué una clave propia y no el contexto del teléfono ────────────────
 *
 * Porque son dos preguntas distintas y hasta hoy compartían una respuesta:
 * "¿de qué venimos hablando con este teléfono?" —que por definición es una
 * sola y la última— y "¿de qué turno es este mensaje?" —que es una por
 * mensaje y no cambia nunca—. La segunda no se puede guardar en una variable
 * que la primera sobreescribe.
 *
 * ── Qué pasa si no hay `context.id` ───────────────────────────────────────
 *
 * Se cae al contexto del teléfono, que es el comportamiento anterior. Pasa con
 * los mensajes mandados antes de este cambio, y podría pasar si Meta dejara de
 * mandar el `context` en algún tipo de respuesta. Quien lea esto buscando por
 * qué se confirmó el turno equivocado: el log dice cuál de los dos caminos se
 * usó.
 */

import { getRedisClient } from "./redis"
import type { ChatbotData } from "./appointment-flow-state"

const PREFIJO = "recordatorio:wamid:"

/**
 * Siete días.
 *
 * Los botones de un recordatorio quedan tocables para siempre del lado del
 * paciente, y alguien que lo toca una semana después igual merece que se
 * confirme el turno correcto. Más allá de eso el turno ya pasó. Es más
 * generoso que las 48 h del contexto del teléfono a propósito: acá no hay
 * nada que se desactualice —el contenido es el de un mensaje ya enviado—.
 */
const VIDA_SEGUNDOS = 7 * 24 * 60 * 60

export interface RecordatorioDelMensaje {
  configId: string
  telefono: string
  wamid: string
  enviadoEl: string
  chatbotData: ChatbotData
}

/** El `wamid` de la respuesta de Meta, con los nombres que puede traer. */
export function wamidDelEnvio(respuesta: any): string | undefined {
  const id =
    respuesta?.messages?.[0]?.id || respuesta?.message_id || respuesta?.wamid || undefined
  return typeof id === "string" && id.trim() ? id.trim() : undefined
}

/**
 * Guarda el recordatorio bajo el id de su mensaje.
 *
 * Nunca lanza: el recordatorio ya salió. Si esto falla, el botón cae al
 * contexto del teléfono —el comportamiento de antes— y no se pierde nada que
 * no estuviera perdido.
 */
export async function guardarRecordatorioDelMensaje(params: {
  configId: string
  telefono: string
  wamid?: string
  chatbotData: ChatbotData
}): Promise<boolean> {
  const { configId, telefono, wamid, chatbotData } = params
  if (!wamid || !configId || !telefono) return false

  const redis = getRedisClient()
  if (!redis) return false

  const guardado: RecordatorioDelMensaje = {
    configId,
    telefono,
    wamid,
    enviadoEl: new Date().toISOString(),
    chatbotData,
  }

  try {
    await redis.set(`${PREFIJO}${wamid}`, JSON.stringify(guardado), { ex: VIDA_SEGUNDOS })
    console.log(
      `[RECORDATORIO] Turno del mensaje ${wamid} guardado ` +
        `(dni ${chatbotData.paciente?.dni || "—"}, ${chatbotData.turnos?.length ?? 0} turno/s)`,
    )
    return true
  } catch (error) {
    console.warn("[RECORDATORIO] No se pudo guardar el turno del mensaje:", error)
    return false
  }
}

/**
 * El recordatorio de ese mensaje, si es de este teléfono y esta clínica.
 *
 * El `wamid` lo manda el cliente —viene en el webhook— así que no alcanza con
 * que exista la clave: se verifica que el mensaje sea de quien está
 * escribiendo. Sin esa verificación, un `context.id` ajeno dejaría confirmar
 * el turno de otro paciente, que es exactamente el problema que esto viene a
 * resolver.
 */
export async function leerRecordatorioDelMensaje(params: {
  configId: string
  telefono: string
  wamid?: string | null
}): Promise<ChatbotData | null> {
  const { configId, telefono, wamid } = params
  if (!wamid || !configId || !telefono) return null

  const redis = getRedisClient()
  if (!redis) return null

  try {
    const crudo = await redis.get(`${PREFIJO}${wamid}`)
    if (!crudo) return null

    const guardado = (typeof crudo === "string" ? JSON.parse(crudo) : crudo) as RecordatorioDelMensaje
    if (!guardado?.chatbotData) return null

    if (guardado.configId !== configId || guardado.telefono !== telefono) {
      console.warn(
        `[RECORDATORIO] ${wamid} no es de ${telefono}@${configId} ` +
          `(es de ${guardado.telefono}@${guardado.configId}): se ignora`,
      )
      return null
    }

    return guardado.chatbotData
  } catch (error) {
    console.warn(`[RECORDATORIO] No se pudo leer el turno del mensaje ${wamid}:`, error)
    return null
  }
}

/** El id del mensaje al que el paciente está respondiendo, si lo hay. */
export function wamidDelMensajeRespondido(message: any): string | undefined {
  const id = message?.context?.id
  return typeof id === "string" && id.trim() ? id.trim() : undefined
}
