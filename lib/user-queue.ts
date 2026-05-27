import { getRedisClient } from "./redis"
import { processIndividualMessage } from "./whatsapp"
import { logger } from "./logger"

interface QueuedMessage {
  userMessage: string
  messageType?: string
  phoneNumberId: string
  config: any
  timestamp: number
  audioId?: string
  audioMimeType?: string
  routeToReagendamiento?: boolean
  functionArgs?: any
}

// Redis keys for distributed processing state
const PROCESSING_KEY_PREFIX = "processing_user:"

async function isUserProcessing(userPhoneNumber: string): Promise<boolean> {
  const redisClient = getRedisClient()
  if (!redisClient) {
    return false
  }
  try {
    const key = `${PROCESSING_KEY_PREFIX}${userPhoneNumber}`
    const result = await redisClient.get(key)
    return result !== null
  } catch (error) {
    logger.error("USER-QUEUE", `Error checking if user is processing: ${userPhoneNumber}`, error)
    return false
  }
}

async function setUserProcessing(userPhoneNumber: string): Promise<void> {
  const redisClient = getRedisClient()
  if (!redisClient) {
    return
  }
  try {
    const key = `${PROCESSING_KEY_PREFIX}${userPhoneNumber}`
    // Set with 5-minute expiration (in case the process crashes)
    await redisClient.setex(key, 300, "1")
  } catch (error) {
    logger.error("USER-QUEUE", `Error setting user as processing: ${userPhoneNumber}`, error)
  }
}

async function clearUserProcessing(userPhoneNumber: string): Promise<void> {
  const redisClient = getRedisClient()
  if (!redisClient) {
    return
  }
  try {
    const key = `${PROCESSING_KEY_PREFIX}${userPhoneNumber}`
    await redisClient.del(key)
  } catch (error) {
    logger.error("USER-QUEUE", `Error clearing user processing: ${userPhoneNumber}`, error)
  }
}

export async function enqueueUserMessage(
  userPhoneNumber: string,
  messageData: {
    userMessage: string
    messageType?: string
    phoneNumberId: string
    config: any
    audioId?: string
    audioMimeType?: string
    routeToReagendamiento?: boolean
    functionArgs?: any
  },
) {
  logger.debug("USER-QUEUE", `Encolando: ${userPhoneNumber}`)

  const redisClient = getRedisClient()
  if (!redisClient) {
    logger.warn("USER-QUEUE", "Redis no disponible, procesando directamente")
    await processIndividualMessage(
      messageData.userMessage,
      messageData.phoneNumberId,
      messageData.config,
      userPhoneNumber,
      messageData.messageType,
      messageData.audioId,
      messageData.audioMimeType,
      messageData.routeToReagendamiento,
      messageData.functionArgs,
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
      audioId: messageData.audioId,
      audioMimeType: messageData.audioMimeType,
      routeToReagendamiento: messageData.routeToReagendamiento,
      functionArgs: messageData.functionArgs,
    }

    const serializedMessage = JSON.stringify(queuedMessage)
    const queueKey = `user_queue:${userPhoneNumber}`

    await redisClient.lpush(queueKey, serializedMessage)
    await redisClient.expire(queueKey, 24 * 60 * 60)

    logger.info("USER-QUEUE", `Encolado ✓: ${userPhoneNumber}`)

    await processUserQueue(userPhoneNumber)
  } catch (error) {
    logger.error("USER-QUEUE", `Error encolando: ${userPhoneNumber}`, error)
    await processIndividualMessage(
      messageData.userMessage,
      messageData.phoneNumberId,
      messageData.config,
      userPhoneNumber,
      messageData.messageType,
      messageData.audioId,
      messageData.audioMimeType,
    )
  }
}

async function processUserQueue(userPhoneNumber: string) {
  const isProcessing = await isUserProcessing(userPhoneNumber)
  if (isProcessing) {
    logger.debug("USER-QUEUE", `Ya procesando: ${userPhoneNumber}`)
    return
  }

  const redisClient = getRedisClient()
  if (!redisClient) {
    logger.warn("USER-QUEUE", "Redis no disponible")
    return
  }

  await setUserProcessing(userPhoneNumber)

  try {
    logger.info("USER-QUEUE", `Procesando cola: ${userPhoneNumber}`)

    const queueKey = `user_queue:${userPhoneNumber}`
    let processedCount = 0

    while (true) {
      const rawMessage = await redisClient.rpop(queueKey)

      if (!rawMessage) {
        logger.debug("USER-QUEUE", `Cola vacía: ${userPhoneNumber} (${processedCount} procesados)`)
        break
      }

      try {
        let serializedMessage: string

        if (typeof rawMessage === "string") {
          serializedMessage = rawMessage
        } else if (typeof rawMessage === "object" && rawMessage !== null) {
          if (Array.isArray(rawMessage)) {
            logger.warn("USER-QUEUE", "Mensaje es array, saltando")
            continue
          }

          if (rawMessage.userMessage && rawMessage.phoneNumberId && rawMessage.config) {
            await processIndividualMessage(
              rawMessage.userMessage,
              rawMessage.phoneNumberId,
              rawMessage.config,
              userPhoneNumber,
              rawMessage.messageType || "text",
              rawMessage.audioId,
              rawMessage.audioMimeType,
              rawMessage.routeToReagendamiento,
              rawMessage.functionArgs,
            )
            processedCount++
            continue
          }

          try {
            serializedMessage = JSON.stringify(rawMessage)
          } catch (serializeError) {
            logger.error("USER-QUEUE", "Error serializando objeto")
            continue
          }
        } else {
          logger.warn("USER-QUEUE", `Tipo no soportado: ${typeof rawMessage}`)
          continue
        }

        let queuedMessage: QueuedMessage
        try {
          queuedMessage = JSON.parse(serializedMessage)
        } catch (parseError) {
          logger.error("USER-QUEUE", "Error parseando mensaje")
          continue
        }

        const unsupportedTypes = ["reaction", "sticker"]
        const isUnsupportedType = unsupportedTypes.includes(queuedMessage.messageType || "")
        const isAudioMessage = queuedMessage.messageType === "audio"

        if (!queuedMessage.phoneNumberId || !queuedMessage.config) {
          logger.warn("USER-QUEUE", "Estructura inválida: falta phoneNumberId o config")
          continue
        }

        // Allow empty userMessage for unsupported types and audio messages (audio will be transcribed)
        if (!queuedMessage.userMessage && !isUnsupportedType && !isAudioMessage) {
          logger.warn("USER-QUEUE", "Estructura inválida: mensaje vacío y tipo no soportado")
          continue
        }

        logger.debug("USER-QUEUE", `Procesando msg ${processedCount + 1}`)

        await processIndividualMessage(
          queuedMessage.userMessage,
          queuedMessage.phoneNumberId,
          queuedMessage.config,
          userPhoneNumber,
          queuedMessage.messageType || "text",
          queuedMessage.audioId,
          queuedMessage.audioMimeType,
          queuedMessage.routeToReagendamiento,
          queuedMessage.functionArgs,
        )

        processedCount++
      } catch (error) {
        logger.error("USER-QUEUE", `Error procesando mensaje`, error)
      }

      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    logger.info("USER-QUEUE", `Completado: ${userPhoneNumber} (${processedCount} msgs)`)
  } catch (error) {
    logger.error("USER-QUEUE", `Error en cola: ${userPhoneNumber}`, error)
  } finally {
    await clearUserProcessing(userPhoneNumber)
  }
}

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
    const isProcessing = await isUserProcessing(userPhoneNumber)

    return {
      queueLength,
      isProcessing,
    }
  } catch (error) {
    logger.error("USER-QUEUE", `Error obteniendo estado: ${userPhoneNumber}`, error)
    return {
      queueLength: 0,
      isProcessing: false,
    }
  }
}

export async function cleanupOldQueues() {
  const redisClient = getRedisClient()
  if (!redisClient) {
    return
  }

  try {
    logger.info("USER-QUEUE", "Limpiando colas antiguas")

    const queueKeys = await redisClient.keys("user_queue:*")

    for (const queueKey of queueKeys) {
      try {
        const ttl = await redisClient.ttl(queueKey)

        if (ttl === -1) {
          await redisClient.expire(queueKey, 24 * 60 * 60)
        }
      } catch (error) {
        logger.error("USER-QUEUE", `Error procesando ${queueKey}`, error)
      }
    }

    logger.info("USER-QUEUE", `Limpieza completada: ${queueKeys.length} colas`)
  } catch (error) {
    logger.error("USER-QUEUE", "Error en limpieza", error)
  }
}

export async function clearAllUserQueues() {
  const redisClient = getRedisClient()
  if (!redisClient) {
    logger.warn("USER-QUEUE", "Redis no disponible para limpiar")
    return
  }

  try {
    const queueKeys = await redisClient.keys("user_queue:*")

    if (queueKeys.length > 0) {
      await redisClient.del(...queueKeys)
      logger.info("USER-QUEUE", `${queueKeys.length} colas eliminadas`)
    } else {
      logger.debug("USER-QUEUE", "No hay colas para eliminar")
    }
  } catch (error) {
    logger.error("USER-QUEUE", "Error limpiando colas", error)
  }
}
