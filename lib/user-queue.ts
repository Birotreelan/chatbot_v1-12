import { getRedisClient } from "./redis"
import { processIndividualMessage } from "./whatsapp"

interface QueuedMessage {
  userMessage: string
  messageType: string
  phoneNumberId: string
  config: any
  timestamp: number
}

// Mapa para rastrear qué usuarios están siendo procesados
const processingUsers = new Set<string>()

export async function enqueueUserMessage(userPhoneNumber: string, messageData: Omit<QueuedMessage, "timestamp">) {
  try {
    const redis = getRedisClient()
    if (!redis) {
      // Si no hay Redis, procesar directamente
      await processIndividualMessage(
        messageData.userMessage,
        messageData.phoneNumberId,
        messageData.config,
        userPhoneNumber,
        messageData.messageType,
      )
      return
    }

    const queueKey = `user_queue:${userPhoneNumber}`
    const message: QueuedMessage = {
      ...messageData,
      timestamp: Date.now(),
    }

    // Añadir mensaje a la cola
    await redis.lpush(queueKey, JSON.stringify(message))

    // Procesar la cola si no está siendo procesada
    await processUserQueue(userPhoneNumber)
  } catch (error) {
    console.error(`[USER-QUEUE] Error encolando mensaje para ${userPhoneNumber}:`, error)
    // Fallback: procesar directamente
    await processIndividualMessage(
      messageData.userMessage,
      messageData.phoneNumberId,
      messageData.config,
      userPhoneNumber,
      messageData.messageType,
    )
  }
}

// Función para procesar cola de usuario
async function processUserQueue(userPhoneNumber: string) {
  const redis = getRedisClient()
  if (!redis) return

  const lockKey = `user_queue_lock:${userPhoneNumber}`
  const queueKey = `user_queue:${userPhoneNumber}`

  try {
    // Intentar obtener lock
    const lockAcquired = await redis.set(lockKey, "1", { ex: 60, nx: true })
    if (!lockAcquired) {
      return // Otro proceso está procesando esta cola
    }

    while (true) {
      // Obtener siguiente mensaje
      const messageData = await redis.rpop(queueKey)
      if (!messageData) {
        break // Cola vacía
      }

      let message: QueuedMessage
      try {
        if (typeof messageData === "string") {
          message = JSON.parse(messageData)
        } else if (typeof messageData === "object" && messageData !== null) {
          message = messageData as QueuedMessage
        } else {
          continue
        }
      } catch (parseError) {
        continue
      }

      // Procesar mensaje
      try {
        await processIndividualMessage(
          message.userMessage,
          message.phoneNumberId,
          message.config,
          userPhoneNumber,
          message.messageType,
        )
      } catch (error) {
        console.error(`[USER-QUEUE] Error procesando mensaje para ${userPhoneNumber}:`, error)
      }
    }
  } catch (error) {
    console.error(`[USER-QUEUE] Error procesando cola para ${userPhoneNumber}:`, error)
  } finally {
    // Liberar lock
    try {
      await redis.del(lockKey)
    } catch (error) {
      // Ignorar errores al liberar lock
    }
  }
}

// Función para obtener el estado de la cola de un usuario
export async function getUserQueueStatus(userPhoneNumber: string) {
  const redisClient = getRedisClient()
  if (!redisClient) {
    return {
      queueLength: 0,
      isProcessing: false,
    }
  }

  try {
    const queueKey = `user_queue:${userPhoneNumber}`
    const queueLength = await redisClient.llen(queueKey)
    const lockKey = `user_queue_lock:${userPhoneNumber}`
    const isProcessing = (await redisClient.exists(lockKey)) === 1

    return {
      queueLength,
      isProcessing,
    }
  } catch (error) {
    console.error(`[USER-QUEUE] Error al obtener estado de cola para ${userPhoneNumber}:`, error)
    return {
      queueLength: 0,
      isProcessing: false,
    }
  }
}

// Función para limpiar colas antiguas (puede ser llamada por un cron job)
export async function cleanupOldQueues() {
  const redisClient = getRedisClient()
  if (!redisClient) {
    return
  }

  try {
    console.log("[USER-QUEUE] Iniciando limpieza de colas antiguas")

    // Buscar todas las colas de usuarios
    const queueKeys = await redisClient.keys("user_queue:*")

    for (const queueKey of queueKeys) {
      try {
        // Verificar si la cola tiene TTL
        const ttl = await redisClient.ttl(queueKey)

        if (ttl === -1) {
          // Si no tiene TTL, establecer uno (24 horas)
          await redisClient.expire(queueKey, 24 * 60 * 60)
          console.log(`[USER-QUEUE] TTL establecido para ${queueKey}`)
        }
      } catch (error) {
        console.error(`[USER-QUEUE] Error al procesar ${queueKey}:`, error)
      }
    }

    console.log(`[USER-QUEUE] Limpieza completada. Procesadas ${queueKeys.length} colas`)
  } catch (error) {
    console.error("[USER-QUEUE] Error durante la limpieza de colas:", error)
  }
}

// Función para limpiar colas existentes
export async function clearAllUserQueues() {
  const redisClient = getRedisClient()
  if (!redisClient) {
    console.warn("[USER-QUEUE] Redis no disponible para limpiar colas")
    return
  }

  try {
    console.log("[USER-QUEUE] Limpiando todas las colas existentes...")

    // Buscar todas las colas de usuarios
    const queueKeys = await redisClient.keys("user_queue:*")

    if (queueKeys.length > 0) {
      // Eliminar todas las colas
      await redisClient.del(...queueKeys)
      console.log(`[USER-QUEUE] ${queueKeys.length} colas eliminadas`)
    } else {
      console.log("[USER-QUEUE] No hay colas para eliminar")
    }
  } catch (error) {
    console.error("[USER-QUEUE] Error al limpiar colas:", error)
  }
}
