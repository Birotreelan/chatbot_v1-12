import { getRedisClient } from "./redis"
import { processIndividualMessage } from "./whatsapp"
import { logger } from "./logger"
import { nanoid } from "nanoid"

interface QueuedMessage {
  userMessage: string
  messageType?: string
  phoneNumberId: string
  config: any
  timestamp: number
}

// <CHANGE> Removed in-memory Set, using Redis locks instead
// const processingUsers = new Set<string>()

// <CHANGE> Added distributed lock functions for Redis
async function acquireProcessingLock(userPhoneNumber: string, ttl = 60): Promise<string | null> {
  const redisClient = getRedisClient()
  if (!redisClient) {
    logger.warn("USER-QUEUE", "Redis no disponible para lock")
    return null
  }

  const lockKey = `processing_lock:${userPhoneNumber}`
  const lockId = nanoid()

  try {
    // SET with NX (only if not exists) and EX (expire)
    const acquired = await redisClient.set(lockKey, lockId, {
      nx: true,
      ex: ttl,
    })

    if (acquired) {
      logger.debug("USER-QUEUE", `Lock adquirido: ${userPhoneNumber} (${lockId})`)
      return lockId
    }

    logger.debug("USER-QUEUE", `Lock ya existe: ${userPhoneNumber}`)
    return null
  } catch (error) {
    logger.error("USER-QUEUE", `Error adquiriendo lock: ${userPhoneNumber}`, error)
    return null
  }
}

async function releaseProcessingLock(userPhoneNumber: string, lockId: string): Promise<void> {
  const redisClient = getRedisClient()
  if (!redisClient) {
    return
  }

  const lockKey = `processing_lock:${userPhoneNumber}`

  try {
    const currentLock = await redisClient.get(lockKey)

    // Only release if we own the lock
    if (currentLock === lockId) {
      await redisClient.del(lockKey)
      logger.debug("USER-QUEUE", `Lock liberado: ${userPhoneNumber} (${lockId})`)
    } else {
      logger.warn("USER-QUEUE", `Lock no coincide: ${userPhoneNumber} (esperado: ${lockId}, actual: ${currentLock})`)
    }
  } catch (error) {
    logger.error("USER-QUEUE", `Error liberando lock: ${userPhoneNumber}`, error)
  }
}

async function extendProcessingLock(userPhoneNumber: string, lockId: string, ttl = 60): Promise<boolean> {
  const redisClient = getRedisClient()
  if (!redisClient) {
    return false
  }

  const lockKey = `processing_lock:${userPhoneNumber}`

  try {
    const currentLock = await redisClient.get(lockKey)

    // Only extend if we own the lock
    if (currentLock === lockId) {
      await redisClient.expire(lockKey, ttl)
      logger.debug("USER-QUEUE", `Lock extendido: ${userPhoneNumber} (${lockId})`)
      return true
    }

    return false
  } catch (error) {
    logger.error("USER-QUEUE", `Error extendiendo lock: ${userPhoneNumber}`, error)
    return false
  }
}
// </CHANGE>

export async function enqueueUserMessage(
  userPhoneNumber: string,
  messageData: {
    userMessage: string
    messageType?: string
    phoneNumberId: string
    config: any
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

    logger.info("USER-QUEUE", `Encolado ✓: ${userPhoneNumber}`)

    // <CHANGE> Trigger processing without waiting
    processUserQueue(userPhoneNumber).catch((error) => {
      logger.error("USER-QUEUE", `Error en processUserQueue: ${userPhoneNumber}`, error)
    })
    // </CHANGE>
  } catch (error) {
    logger.error("USER-QUEUE", `Error encolando: ${userPhoneNumber}`, error)
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
  // <CHANGE> Use Redis distributed lock instead of in-memory Set
  const lockId = await acquireProcessingLock(userPhoneNumber, 60)

  if (!lockId) {
    logger.debug("USER-QUEUE", `Ya procesando (lock activo): ${userPhoneNumber}`)
    return
  }
  // </CHANGE>

  const redisClient = getRedisClient()
  if (!redisClient) {
    logger.warn("USER-QUEUE", "Redis no disponible")
    await releaseProcessingLock(userPhoneNumber, lockId)
    return
  }

  try {
    logger.info("USER-QUEUE", `Procesando cola: ${userPhoneNumber}`)

    const queueKey = `user_queue:${userPhoneNumber}`
    let processedCount = 0
    let lastLockExtension = Date.now()

    while (true) {
      // <CHANGE> Extend lock every 30 seconds to prevent expiration during long processing
      if (Date.now() - lastLockExtension > 30000) {
        const extended = await extendProcessingLock(userPhoneNumber, lockId, 60)
        if (!extended) {
          logger.warn("USER-QUEUE", `No se pudo extender lock, abortando: ${userPhoneNumber}`)
          break
        }
        lastLockExtension = Date.now()
      }
      // </CHANGE>

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

        const unsupportedTypes = ["reaction", "sticker", "audio"]
        const isUnsupportedType = unsupportedTypes.includes(queuedMessage.messageType || "")

        if (!queuedMessage.phoneNumberId || !queuedMessage.config) {
          logger.warn("USER-QUEUE", "Estructura inválida: falta phoneNumberId o config")
          continue
        }

        // Allow empty userMessage only for unsupported types
        if (!queuedMessage.userMessage && !isUnsupportedType) {
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
    // <CHANGE> Release distributed lock
    await releaseProcessingLock(userPhoneNumber, lockId)
    // </CHANGE>
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
    
    // <CHANGE> Check Redis lock instead of in-memory Set
    const lockKey = `processing_lock:${userPhoneNumber}`
    const lockValue = await redisClient.get(lockKey)
    const isProcessing = lockValue !== null
    // </CHANGE>

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

// ... existing code ...
