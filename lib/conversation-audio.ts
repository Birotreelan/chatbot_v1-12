/**
 * lib/conversation-audio.ts
 *
 * Guarda el audio original que envía el paciente para poder escucharlo desde el
 * panel (31/8/2026, pedido de Nicolás). Hasta ahora el audio se descargaba de
 * WhatsApp, se transcribía con Whisper y se descartaba: en el panel sólo quedaba
 * la transcripción, así que si Whisper entendía mal no había forma de saber qué
 * había dicho realmente el paciente.
 *
 * Decisiones de diseño:
 *
 * - **TTL atado a la conversación.** El audio vive exactamente lo mismo que la
 *   conversación en Redis (7 días). Si la conversación caducó, el audio también:
 *   no queda material de voz de pacientes sin la conversación que le da contexto.
 *
 * - **Tope de tamaño.** Los audios de WhatsApp son ogg/opus (~1 KB por segundo),
 *   pero base64 agrega 33% y Redis cobra por bytes transferidos. Un audio que
 *   supere el tope no se guarda (la transcripción sigue funcionando igual): es
 *   preferible perder la reproducción de un audio largo y raro antes que repetir
 *   el incidente de bandwidth de Upstash.
 *
 * - **Nunca rompe el flujo.** Todo error se traga y se loguea. Guardar el audio
 *   es una mejora de observabilidad, no puede impedir que se atienda al paciente.
 */

import { getRedisClient } from "./redis"

const AUDIO_PREFIX = "conversation_audio:"

/** Igual que CONVERSATION_TTL en lib/conversations.ts — los dos deben caducar juntos. */
const AUDIO_TTL = 7 * 24 * 60 * 60 // 7 días

/**
 * Tope del audio ORIGINAL (antes de base64). 1.5 MB de ogg/opus son ~20 minutos
 * de voz: muy por encima de cualquier mensaje real de un paciente.
 */
const MAX_AUDIO_BYTES = 1_500_000

export interface AudioGuardado {
  base64: string
  mimeType: string
}

function audioKey(configId: string, phoneNumber: string, messageId: string): string {
  return `${AUDIO_PREFIX}${configId}:${phoneNumber}:${messageId}`
}

/**
 * Guarda el audio de un mensaje entrante. Devuelve true si quedó disponible
 * para reproducir.
 */
export async function saveConversationAudio(
  configId: string,
  phoneNumber: string,
  messageId: string,
  audio: Buffer,
  mimeType?: string,
): Promise<boolean> {
  try {
    if (!configId || !phoneNumber || !messageId) return false

    if (audio.length > MAX_AUDIO_BYTES) {
      console.warn(
        `[CONV-AUDIO] Audio de ${phoneNumber} descartado por tamaño (${audio.length} bytes > ${MAX_AUDIO_BYTES})`,
      )
      return false
    }

    const redis = getRedisClient()
    if (!redis) return false

    const payload: AudioGuardado = {
      base64: audio.toString("base64"),
      mimeType: mimeType || "audio/ogg",
    }

    await redis.setex(audioKey(configId, phoneNumber, messageId), AUDIO_TTL, JSON.stringify(payload))
    console.info(`[CONV-AUDIO] Audio guardado para ${phoneNumber} (${audio.length} bytes, ${payload.mimeType})`)
    return true
  } catch (error) {
    console.error("[CONV-AUDIO] Error guardando audio:", error)
    return false
  }
}

/** Recupera el audio guardado, o null si expiró / nunca se guardó. */
export async function getConversationAudio(
  configId: string,
  phoneNumber: string,
  messageId: string,
): Promise<AudioGuardado | null> {
  try {
    const redis = getRedisClient()
    if (!redis) return null

    const raw = await redis.get(audioKey(configId, phoneNumber, messageId))
    if (!raw) return null

    const parsed = typeof raw === "string" ? JSON.parse(raw) : (raw as AudioGuardado)
    if (!parsed?.base64) return null

    return { base64: parsed.base64, mimeType: parsed.mimeType || "audio/ogg" }
  } catch (error) {
    console.error("[CONV-AUDIO] Error leyendo audio:", error)
    return null
  }
}
