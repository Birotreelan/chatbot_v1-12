import { NextResponse } from "next/server"
import { Redis } from "@upstash/redis"
import { incrementMetric, logError } from "@/lib/monitoring"

// Prefijos de conversaciones (deben coincidir con lib/conversations.ts)
const CONVERSATION_PREFIX = "conversation:"
const CONVERSATION_CONTACT_PREFIX = "conversation_contact:"
const CONVERSATION_CONTACTS_SET_PREFIX = "conversation_contacts:"
const CONVERSATION_PAUSED_PREFIX = "conversation_paused:"

async function scanKeys(redis: Redis, pattern: string, maxKeys = 1000): Promise<string[]> {
  const keys: string[] = []
  let cursor = 0

  do {
    // SCAN returns [cursor, keys[]]
    const result = await redis.scan(cursor, { match: pattern, count: 100 })
    cursor = result[0]
    const foundKeys = result[1] as string[]

    keys.push(...foundKeys)

    // Stop if we've collected enough keys
    if (keys.length >= maxKeys) {
      break
    }
  } while (cursor !== 0)

  return keys.slice(0, maxKeys)
}

// Función para limpiar datos antiguos
export async function GET(req: Request) {
  try {
    const redis = Redis.fromEnv()
    const now = Date.now()

    // Configuración de días para limpieza
    const threadDays = Number(process.env.CLEANUP_THREAD_DAYS || 30)
    const metricsDays = Number(process.env.CLEANUP_LOGS_DAYS || 30)
    const cacheDays = Number(process.env.CLEANUP_CACHE_HOURS || 24) / 24 // Convertir horas a días
    const conversationDays = Number(process.env.CLEANUP_CONVERSATION_DAYS || 7) // Conversaciones: 7 días por defecto

    const THREAD_CUTOFF = now - threadDays * 24 * 60 * 60 * 1000
    const METRICS_CUTOFF = now - metricsDays * 24 * 60 * 60 * 1000
    const CACHE_CUTOFF = now - cacheDays * 24 * 60 * 60 * 1000
    const CONVERSATION_CUTOFF = now - conversationDays * 24 * 60 * 60 * 1000

    // Limitar el número de elementos a procesar en cada categoría para evitar timeouts
    const MAX_ITEMS_PER_CATEGORY = 1000

    // 1. Limpiar threads inactivos
    const threadKeys = await scanKeys(redis, "thread:*", MAX_ITEMS_PER_CATEGORY)
    let threadsDeleted = 0
    let threadsConverted = 0

    for (const key of threadKeys) {
      const threadData = await redis.get(key)
      if (threadData) {
        try {
          let thread: any = null

          // Try to parse as JSON first
          if (typeof threadData === "string" && threadData.startsWith("{")) {
            thread = JSON.parse(threadData)
          } else if (typeof threadData === "object") {
            thread = threadData
          } else {
            // Old format: just a threadId string like "thread_VAKW"
            // Convert to new format or delete if too old
            console.log(`[CLEANUP] Found old format thread data: ${threadData}`)

            // Since we don't have timestamp info for old format, delete it
            await redis.del(key)
            threadsDeleted++
            threadsConverted++
            continue
          }

          const lastMessageTime = thread.lastMessageAt ? new Date(thread.lastMessageAt).getTime() : 0

          if (lastMessageTime < THREAD_CUTOFF) {
            await redis.del(key)
            threadsDeleted++
          }
        } catch (e) {
          // Si no podemos parsear el thread, lo eliminamos por seguridad
          console.error(`[CLEANUP] Error parsing thread ${key}:`, e)
          await redis.del(key)
          threadsDeleted++
        }
      }
    }

    // 2. Limpiar métricas antiguas
    const metricKeys = await scanKeys(redis, "metrics:*", MAX_ITEMS_PER_CATEGORY)
    let metricsCleanedUp = 0

    for (const key of metricKeys) {
      const metrics = await redis.hgetall(key)
      if (metrics) {
        for (const [date, _] of Object.entries(metrics)) {
          // Si la fecha es anterior al cutoff y no es "total"
          if (date !== "total" && new Date(date).getTime() < METRICS_CUTOFF) {
            await redis.hdel(key, date)
            metricsCleanedUp++
          }
        }
      }
    }

    // 3. Limpiar caché de API
    const cacheKeys = await scanKeys(redis, "api_cache:*", MAX_ITEMS_PER_CATEGORY)
    let cacheEntriesDeleted = 0

    for (const key of cacheKeys) {
      const cacheData = await redis.get(key)
      if (cacheData) {
        try {
          const cache = JSON.parse(cacheData as string)
          const timestamp = cache.timestamp || 0

          if (timestamp < CACHE_CUTOFF) {
            await redis.del(key)
            cacheEntriesDeleted++
          }
        } catch (e) {
          // Si no podemos parsear la caché, la eliminamos
          await redis.del(key)
          cacheEntriesDeleted++
        }
      }
    }

    // 4. Limpiar datos de rate limiting antiguos
    const rateLimitKeys = await scanKeys(redis, "ratelimit:*", MAX_ITEMS_PER_CATEGORY)
    let rateLimitEntriesDeleted = 0

    for (const key of rateLimitKeys) {
      // Los datos de rate limiting se limpian automáticamente con TTL,
      // pero verificamos si hay alguno antiguo que no se haya limpiado
      const oldTokens = await redis.zcount(key, 0, CACHE_CUTOFF)

      if (oldTokens > 0) {
        await redis.zremrangebyscore(key, 0, CACHE_CUTOFF)
        rateLimitEntriesDeleted += oldTokens
      }
    }

    // 5. Limpiar conversaciones antiguas (NUEVO - Mayor impacto en bandwidth)
    console.log("[CLEANUP] Iniciando limpieza de conversaciones...")
    const conversationKeys = await scanKeys(redis, `${CONVERSATION_PREFIX}*`, MAX_ITEMS_PER_CATEGORY)
    let conversationsDeleted = 0
    let conversationMessagesDeleted = 0

    for (const key of conversationKeys) {
      try {
        // Obtener el ultimo mensaje para verificar la fecha
        const lastMessage = await redis.lindex(key, -1)
        
        if (lastMessage) {
          let messageData: any = null
          
          if (typeof lastMessage === "string") {
            try {
              messageData = JSON.parse(lastMessage)
            } catch {
              // Si no se puede parsear, eliminar la conversacion
              const msgCount = await redis.llen(key)
              await redis.del(key)
              conversationsDeleted++
              conversationMessagesDeleted += msgCount
              continue
            }
          } else if (typeof lastMessage === "object") {
            messageData = lastMessage
          }

          if (messageData && messageData.timestamp) {
            const messageTime = new Date(messageData.timestamp).getTime()
            
            if (!isNaN(messageTime) && messageTime < CONVERSATION_CUTOFF) {
              const msgCount = await redis.llen(key)
              await redis.del(key)
              conversationsDeleted++
              conversationMessagesDeleted += msgCount
            }
          }
        } else {
          // Lista vacia, eliminar
          await redis.del(key)
          conversationsDeleted++
        }
      } catch (e) {
        console.error(`[CLEANUP] Error procesando conversacion ${key}:`, e)
      }
    }

    // 6. Limpiar contactos de conversaciones antiguas
    const contactKeys = await scanKeys(redis, `${CONVERSATION_CONTACT_PREFIX}*`, MAX_ITEMS_PER_CATEGORY)
    let contactsDeleted = 0

    for (const key of contactKeys) {
      try {
        const contactData = await redis.get(key)
        
        if (contactData) {
          let contact: any = null
          
          if (typeof contactData === "string") {
            try {
              contact = JSON.parse(contactData)
            } catch {
              await redis.del(key)
              contactsDeleted++
              continue
            }
          } else if (typeof contactData === "object") {
            contact = contactData
          }

          if (contact && contact.lastMessageAt) {
            const contactTime = new Date(contact.lastMessageAt).getTime()
            
            if (!isNaN(contactTime) && contactTime < CONVERSATION_CUTOFF) {
              await redis.del(key)
              contactsDeleted++
              
              // Tambien remover del set de contactos
              if (contact.configId && contact.phoneNumber) {
                const setKey = `${CONVERSATION_CONTACTS_SET_PREFIX}${contact.configId}`
                await redis.srem(setKey, contact.phoneNumber)
              }
            }
          }
        } else {
          await redis.del(key)
          contactsDeleted++
        }
      } catch (e) {
        console.error(`[CLEANUP] Error procesando contacto ${key}:`, e)
      }
    }

    // 7. Limpiar flags de conversaciones pausadas huerfanas
    const pausedKeys = await scanKeys(redis, `${CONVERSATION_PAUSED_PREFIX}*`, MAX_ITEMS_PER_CATEGORY)
    let pausedFlagsDeleted = 0

    for (const key of pausedKeys) {
      try {
        // Extraer configId y phoneNumber del key
        const parts = key.replace(CONVERSATION_PAUSED_PREFIX, "").split(":")
        if (parts.length >= 2) {
          const configId = parts[0]
          const phoneNumber = parts.slice(1).join(":")
          
          // Verificar si la conversacion aun existe
          const conversationKey = `${CONVERSATION_PREFIX}${configId}:${phoneNumber}`
          const exists = await redis.exists(conversationKey)
          
          if (!exists) {
            await redis.del(key)
            pausedFlagsDeleted++
          }
        }
      } catch (e) {
        console.error(`[CLEANUP] Error procesando flag pausado ${key}:`, e)
      }
    }

    console.log(`[CLEANUP] Conversaciones eliminadas: ${conversationsDeleted} (${conversationMessagesDeleted} mensajes)`)
    console.log(`[CLEANUP] Contactos eliminados: ${contactsDeleted}`)
    console.log(`[CLEANUP] Flags pausados huerfanos eliminados: ${pausedFlagsDeleted}`)

    // Registrar la limpieza
    await incrementMetric("cleanup_threads_deleted", threadsDeleted)
    await incrementMetric("cleanup_threads_converted", threadsConverted)
    await incrementMetric("cleanup_metrics_deleted", metricsCleanedUp)
    await incrementMetric("cleanup_cache_deleted", cacheEntriesDeleted)
    await incrementMetric("cleanup_ratelimit_deleted", rateLimitEntriesDeleted)
    await incrementMetric("cleanup_conversations_deleted", conversationsDeleted)
    await incrementMetric("cleanup_conversation_messages_deleted", conversationMessagesDeleted)
    await incrementMetric("cleanup_contacts_deleted", contactsDeleted)
    await incrementMetric("cleanup_paused_flags_deleted", pausedFlagsDeleted)

    return NextResponse.json({
      success: true,
      threadsDeleted,
      threadsConverted,
      metricsCleanedUp,
      cacheEntriesDeleted,
      rateLimitEntriesDeleted,
      conversationsDeleted,
      conversationMessagesDeleted,
      contactsDeleted,
      pausedFlagsDeleted,
      keysScanned: {
        threads: threadKeys.length,
        metrics: metricKeys.length,
        cache: cacheKeys.length,
        rateLimit: rateLimitKeys.length,
        conversations: conversationKeys.length,
        contacts: contactKeys.length,
        pausedFlags: pausedKeys.length,
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Error en la limpieza programada:", error)
    await logError("cleanup", error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}

// Configuración para Vercel Cron
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// Configuración de cron usando la nueva sintaxis
export const maxDuration = 300 // 300 segundos máximo de ejecución (límite permitido)

// La configuración del cron se debe hacer en vercel.json
