/**
 * Historial conversacional por número de teléfono
 * Guarda los últimos N mensajes (user + bot) en Redis.
 * Usado como contexto en entity extractor y response generator.
 *
 * OPTIMIZACIÓN Bloque 5: migrado de GET-JSON-SET a RPUSH+LTRIM+LRANGE.
 * - Antes: appendToHistory = 1 GET (leer JSON) + 1 SET (escribir JSON) = 2 requests HTTP
 * - Ahora: appendToHistory = pipeline(RPUSH + LTRIM + EXPIRE) = 1 request HTTP, 0 reads
 * - getHistory: LRANGE = 1 request (igual que antes)
 *
 * Nuevo prefijo `conv_history_v2:` para evitar conflicto de tipo Redis con las
 * claves antiguas `conv_history:` (que son strings, las nuevas son listas).
 * Las claves viejas expirarán naturalmente en 24h.
 */

import { getRedisClient } from '@/lib/redis'

// v2: Redis List en lugar de JSON string — prefijo nuevo para evitar conflicto de tipo
const HISTORY_PREFIX = 'conv_history_v2:'
const HISTORY_TTL = 24 * 60 * 60  // 24 horas
const MAX_MESSAGES = 10

export interface ConversationMessage {
  role: 'user' | 'bot'
  text: string
  timestamp: number
}

/**
 * Agrega un mensaje al historial usando RPUSH + LTRIM.
 * 0 lecturas por llamada; pipeline agrupa los 3 comandos en 1 HTTP request.
 */
export async function appendToHistory(
  phone: string,
  message: ConversationMessage
): Promise<void> {
  try {
    const redis = getRedisClient()
    if (!redis) return

    const key = `${HISTORY_PREFIX}${phone}`
    const entry = JSON.stringify(message)

    // 1 request HTTP: RPUSH (append) + LTRIM (keep last N) + EXPIRE (reset TTL)
    const pipeline = redis.pipeline()
    pipeline.rpush(key, entry)
    pipeline.ltrim(key, -MAX_MESSAGES, -1)
    pipeline.expire(key, HISTORY_TTL)
    await pipeline.exec()
  } catch (error) {
    console.error(`[CONV-HISTORY] Error guardando mensaje para ${phone}:`, error)
  }
}

/**
 * Obtiene el historial completo (hasta MAX_MESSAGES mensajes) con LRANGE.
 */
export async function getHistory(phone: string): Promise<ConversationMessage[]> {
  try {
    const redis = getRedisClient()
    if (!redis) return []

    const key = `${HISTORY_PREFIX}${phone}`
    const items = await redis.lrange(key, 0, -1)
    if (!items || items.length === 0) return []

    return items
      .map((item) => {
        try {
          return typeof item === 'string' ? JSON.parse(item) : item as ConversationMessage
        } catch {
          return null
        }
      })
      .filter(Boolean) as ConversationMessage[]
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
    // Borra clave v2 (List). La clave v1 (String) expira naturalmente en 24h.
    await redis.del(`${HISTORY_PREFIX}${phone}`)
  } catch (error) {
    console.error(`[CONV-HISTORY] Error limpiando historial para ${phone}:`, error)
  }
}
