import { getRedisClient } from "./redis"
import { processIndividualMessage } from "./whatsapp"

interface QueuedMessage {
  userMessage: string
  messageType?: string
  phoneNumberId: string
  config: any
  timestamp: number
}

// Mapa para rastrear qué usuarios están siendo procesados
const processingUsers = new Set<string>()

export async function enqueueUserMessage(
  userPhoneNumber: string,
  messageData: {
    userMessage: string
    messageType?: string
    phoneNumberId: string
    config: any
  },
) {
  console.log(`[QUEUE] 📋 Encolando: ${userPhoneNumber}`)

  const redisClient = getRedisClient()
  if (!redisClient) {
    console.warn(`[QUEUE] ⚠️ Sin Redis, procesando directo`)
    await processIndividualMessage(
      messageData.userMessage,
      messageData.phoneNumberId,
      messageData.config,
      userPhoneNumber,
      messageData.messageType,
    )
    return
  }

  try {
    const queuedMessage: QueuedMessage = {
      userMessage: messageData.userMessage,
      messageType: messageData.messageType || "text",
      phoneNumberId: messageData.phoneNumberId,
      config: JSON.parse(JSON.stringify(messageData.config)),
      timestamp: Date.now(),
    }

    const serializedMessage = JSON.stringify(queuedMessage)
    const queueKey = `user_queue:${userPhoneNumber}`

    await redisClient.lpush(queueKey, serializedMessage)
    await redisClient.expire(queueKey, 24 * 60 * 60)

    console.log(`[QUEUE] ✅ Encolado: ${userPhoneNumber}`)
    await processUserQueue(userPhoneNumber)
  } catch (error) {
    console.error(`[QUEUE] ❌ Error encolar:`, error)
    await processIndividualMessage(
      messageData.userMessage,
      messageData.phoneNumberId,
      messageData.config,
      userPhoneNumber,
      messageData.messageType,
    )
  }
}

async function processUserQueue(userPhoneNumber: string) {
  if (processingUsers.has(userPhoneNumber)) {
    console.log(`[QUEUE] ⏳ Ya procesando: ${userPhoneNumber}`)
    return
  }

  const redisClient = getRedisClient()
  if (!redisClient) {
    console.warn(`[QUEUE] ⚠️ Sin Redis para procesar`)
    return
  }

  processingUsers.add(userPhoneNumber)

  try {
    console.log(`[QUEUE] 🔄 Procesando cola: ${userPhoneNumber}`)
    const queueKey = `user_queue:${userPhoneNumber}`

    while (true) {
      const rawMessage = await redisClient.rpop(queueKey)

      if (!rawMessage) {
        console.log(`[QUEUE] ✅ Cola vacía: ${userPhoneNumber}`)
        break
      }

      try {
        let serializedMessage: string

        if (typeof rawMessage === "string") {
          serializedMessage = rawMessage
        } else if (typeof rawMessage === "object" && rawMessage !== null) {
          if (Array.isArray(rawMessage)) {
            console.error(`[QUEUE] ❌ Array recibido, saltando`)
            continue
          }

          if (rawMessage.userMessage && rawMessage.phoneNumberId && rawMessage.config) {
            console.log(`[QUEUE] 🔄 Procesando objeto directo`)
            await processIndividualMessage(
              rawMessage.userMessage,
              rawMessage.phoneNumberId,
              rawMessage.config,
              userPhoneNumber,
              rawMessage.messageType || "text",
            )
            console.log(`[QUEUE] ✅ Mensaje procesado: ${userPhoneNumber}`)
            continue
          }

          try {
            serializedMessage = JSON.stringify(rawMessage)
          } catch (serializeError) {
            console.error(`[QUEUE] ❌ Error serializar:`, serializeError)
            continue
          }
        } else {
          console.error(`[QUEUE] ❌ Tipo no soportado: ${typeof rawMessage}`)
          continue
        }

        let queuedMessage: QueuedMessage
        try {
          queuedMessage = JSON.parse(serializedMessage)
        } catch (parseError) {
          console.error(`[QUEUE] ❌ Error parsear:`, parseError)
          continue
        }

        if (!queuedMessage.userMessage || !queuedMessage.phoneNumberId || !queuedMessage.config) {
          console.error(`[QUEUE] ❌ Estructura inválida`)
          continue
        }

        console.log(`[QUEUE] 🔄 Procesando: "${queuedMessage.userMessage.substring(0, 30)}..."`)

        await processIndividualMessage(
          queuedMessage.userMessage,
          queuedMessage.phoneNumberId,
          queuedMessage.config,
          userPhoneNumber,
          queuedMessage.messageType || "text",
        )

        console.log(`[QUEUE] ✅ Mensaje procesado: ${userPhoneNumber}`)
      } catch (error) {
        console.error(`[QUEUE] ❌ Error procesar mensaje:`, error)
      }

      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  } catch (error) {
    console.error(`[QUEUE] ❌ Error procesar cola:`, error)
  } finally {
    processingUsers.delete(userPhoneNumber)
    console.log(`[QUEUE] ✅ Completado: ${userPhoneNumber}`)
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
    const isProcessing = processingUsers.has(userPhoneNumber)

    return {
      queueLength,
      isProcessing,
    }
  } catch (error) {
    console.error(`[QUEUE] ❌ Error estado:`, error)
    return {
      queueLength: 0,
      isProcessing: false,
    }
  }
}

// Función para limpiar colas antiguas
export async function cleanupOldQueues() {
  const redisClient = getRedisClient()
  if (!redisClient) {
    return
  }

  try {
    console.log(`[QUEUE] 🧹 Limpiando colas antiguas`)
    const queueKeys = await redisClient.keys("user_queue:*")

    for (const queueKey of queueKeys) {
      try {
        const ttl = await redisClient.ttl(queueKey)
        if (ttl === -1) {
          await redisClient.expire(queueKey, 24 * 60 * 60)
          console.log(`[QUEUE] ⏰ TTL establecido: ${queueKey}`)
        }
      } catch (error) {
        console.error(`[QUEUE] ❌ Error procesar ${queueKey}:`, error)
      }
    }

    console.log(`[QUEUE] ✅ Limpieza completada: ${queueKeys.length} colas`)
  } catch (error) {
    console.error(`[QUEUE] ❌ Error limpieza:`, error)
  }
}

// Función para limpiar todas las colas
export async function clearAllUserQueues() {
  const redisClient = getRedisClient()
  if (!redisClient) {
    console.warn(`[QUEUE] ⚠️ Sin Redis para limpiar`)
    return
  }

  try {
    console.log(`[QUEUE] 🧹 Limpiando todas las colas`)
    const queueKeys = await redisClient.keys("user_queue:*")

    if (queueKeys.length > 0) {
      await redisClient.del(...queueKeys)
      console.log(`[QUEUE] ✅ ${queueKeys.length} colas eliminadas`)
    } else {
      console.log(`[QUEUE] ℹ️ No hay colas para eliminar`)
    }
  } catch (error) {
    console.error(`[QUEUE] ❌ Error limpiar:`, error)
  }
}
