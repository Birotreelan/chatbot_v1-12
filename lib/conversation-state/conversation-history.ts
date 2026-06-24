/**
 * Historial conversacional por número de teléfono
 * Guarda los últimos N mensajes (user + bot) en Redis.
 * Usado como contexto en entity extractor y response generator.
 */

import { getRedisClient } from '@/lib/redis'

const HISTORY_PREFIX = 'conv_history:'
const HISTORY_TTL = 24 * 60 * 60  // 24 horas
const MAX_MESSAGES = 10

export interface ConversationMessage {
  role: 'user' | 'bot'
  text: string
  timestamp: number
}

/**
 * Agrega un mensaje al historial (y recorta a MAX_MESSAGES)
 */
export async function appendToHistory(
  phone: string,
  message: ConversationMessage
): Promise<void> {
  try {
    const redis = getRedisClient()
    if (!redis) return

    const key = `${HISTORY_PREFIX}${phone}`
    const raw = await redis.get(key)
    const history: ConversationMessage[] = raw
      ? (typeof raw === 'object' ? raw as ConversationMessage[] : JSON.parse(raw as string))
      : []

    history.push(message)

    // Recortar a las últimas MAX_MESSAGES
    const trimmed = history.slice(-MAX_MESSAGES)
    await redis.setex(key, HISTORY_TTL, JSON.stringify(trimmed))
  } catch (error) {
    console.error(`[CONV-HISTORY] Error guardando mensaje para ${phone}:`, error)
  }
}

/**
 * Obtiene el historial completo (hasta MAX_MESSAGES mensajes)
 */
export async function getHistory(phone: string): Promise<ConversationMessage[]> {
  try {
    const redis = getRedisClient()
    if (!redis) return []

    const key = `${HISTORY_PREFIX}${phone}`
    const raw = await redis.get(key)
    if (!raw) return []

    return typeof raw === 'object'
      ? (raw as ConversationMessage[])
      : JSON.parse(raw as string)
  } catch (error) {
    console.error(`[CONV-HISTORY] Error obteniendo historial para ${phone}:`, error)
    return []
  }
}

/**
 * Formatea el historial como string para incluir en prompts GPT
 * Retorna los últimos N mensajes (default: 6)
 */
export function formatHistoryForPrompt(
  history: ConversationMessage[],
  lastN: number = 6
): string {
  const recent = history.slice(-lastN)
  if (recent.length === 0) return ''

  return recent
    .map(m => `${m.role === 'user' ? 'Paciente' : 'Bot'}: ${m.text}`)
    .join('\n')
}

/**
 * Limpia el historial de un número
 */
export async function clearHistory(phone: string): Promise<void> {
  try {
    const redis = getRedisClient()
    if (!redis) return
    await redis.del(`${HISTORY_PREFIX}${phone}`)
  } catch (error) {
    console.error(`[CONV-HISTORY] Error limpiando historial para ${phone}:`, error)
  }
}
