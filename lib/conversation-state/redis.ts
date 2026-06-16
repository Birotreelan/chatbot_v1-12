/**
 * Storage en Redis para el contexto de conversación
 * Centraliza la persistencia de estado con TTL automático
 */

import { getRedisClient } from "@/lib/redis"
import { ConversationContext } from "./types"

const CONTEXT_PREFIX = "conv_context:"
const DEFAULT_TTL = 48 * 60 * 60 // 48 horas

export interface ConversationStateRedis {
  context: ConversationContext
  metadata: {
    createdAt: string
    lastUpdatedAt: string
  }
}

/**
 * Obtener contexto de conversación del Redis
 */
export async function getConversationContext(
  phone: string,
  configId: string
): Promise<ConversationContext | null> {
  try {
    const redis = getRedisClient()
    if (!redis) return null

    const key = `${CONTEXT_PREFIX}${configId}:${phone}`
    const data = await redis.get(key)

    if (!data) return null

    // Upstash Redis puede devolver objeto ya parseado o string
    const state = (typeof data === 'object' ? data : JSON.parse(data as string)) as ConversationStateRedis

    return state.context
  } catch (error) {
    console.error(`[CONV-CONTEXT] Error obteniendo contexto para ${phone}@${configId}:`, error)
    return null
  }
}

/**
 * Guardar o actualizar contexto de conversación
 */
export async function setConversationContext(
  phone: string,
  configId: string,
  context: ConversationContext,
  ttl: number = DEFAULT_TTL
): Promise<void> {
  try {
    const redis = getRedisClient()
    if (!redis) return

    const key = `${CONTEXT_PREFIX}${configId}:${phone}`
    const now = new Date().toISOString()

    const state: ConversationStateRedis = {
      context: {
        ...context,
        updatedAt: now,
      },
      metadata: {
        createdAt: context.createdAt || now,
        lastUpdatedAt: now,
      },
    }

    await redis.setex(key, ttl, JSON.stringify(state))
  } catch (error) {
    console.error(`[CONV-CONTEXT] Error guardando contexto para ${phone}@${configId}:`, error)
    throw error
  }
}

/**
 * Limpiar contexto (cuando termina el flujo)
 */
export async function clearConversationContext(phone: string, configId: string): Promise<void> {
  try {
    const redis = getRedisClient()
    if (!redis) return

    const key = `${CONTEXT_PREFIX}${configId}:${phone}`
    await redis.del(key)
  } catch (error) {
    console.error(`[CONV-CONTEXT] Error limpiando contexto para ${phone}@${configId}:`, error)
  }
}

/**
 * Obtener todos los contextos activos (para debugging/monitoreo)
 */
export async function getAllActiveContexts(
  configId?: string
): Promise<Array<{ phone: string; context: ConversationContext }>> {
  try {
    const redis = getRedisClient()
    if (!redis) return []

    const pattern = configId ? `${CONTEXT_PREFIX}${configId}:*` : `${CONTEXT_PREFIX}*`
    const keys = await redis.keys(pattern)

    const results: Array<{ phone: string; context: ConversationContext }> = []

    for (const key of keys) {
      const data = await redis.get(key)
      if (data) {
        // Upstash Redis puede devolver objeto ya parseado o string
        const state = (typeof data === 'object' ? data : JSON.parse(data as string)) as ConversationStateRedis
        const phone = key.split(":").pop() || "unknown"
        results.push({
          phone,
          context: state.context,
        })
      }
    }

    return results
  } catch (error) {
    console.error(`[CONV-CONTEXT] Error obteniendo contextos activos:`, error)
    return []
  }
}

/**
 * Estadísticas de contextos activos
 */
export async function getContextStats(configId?: string): Promise<{
  totalActive: number
  byPhase: Record<string, number>
  oldestContext?: { phone: string; createdAt: string }
}> {
  try {
    const contexts = await getAllActiveContexts(configId)

    const byPhase: Record<string, number> = {}
    let oldestContext: { phone: string; createdAt: string } | undefined

    for (const { phone, context } of contexts) {
      byPhase[context.currentPhase] = (byPhase[context.currentPhase] || 0) + 1

      if (!oldestContext || new Date(context.createdAt) < new Date(oldestContext.createdAt)) {
        oldestContext = { phone, createdAt: context.createdAt }
      }
    }

    return {
      totalActive: contexts.length,
      byPhase,
      oldestContext,
    }
  } catch (error) {
    console.error(`[CONV-CONTEXT] Error obteniendo stats:`, error)
    return { totalActive: 0, byPhase: {} }
  }
}
