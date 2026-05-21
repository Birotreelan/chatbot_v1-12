import { getRedisClient } from "./redis"
import { logger } from "./logger"

interface BufferedMessage {
  userMessage: string
  messageType?: string
  phoneNumberId: string
  config: any
  audioId?: string
  audioMimeType?: string
  timestamp: number
}

// Buffer storage for rapid messages - store in Redis with debounce logic
const BUFFER_KEY_PREFIX = "msg_buffer:"
const BUFFER_TIMER_PREFIX = "msg_buffer_timer:"
const BUFFER_DEBOUNCE_MS = 4000 // 4 seconds to aggregate messages

export async function addMessageToBuffer(
  userPhoneNumber: string,
  messageData: {
    userMessage: string
    messageType?: string
    phoneNumberId: string
    config: any
    audioId?: string
    audioMimeType?: string
  },
): Promise<void> {
  const redisClient = getRedisClient()
  if (!redisClient) {
    logger.warn("MSG-BUFFER", "Redis no disponible")
    return
  }

  try {
    const bufferKey = `${BUFFER_KEY_PREFIX}${userPhoneNumber}`
    const timerKey = `${BUFFER_TIMER_PREFIX}${userPhoneNumber}`

    // Add message to buffer
    const bufferedMessage: BufferedMessage = {
      userMessage: messageData.userMessage,
      messageType: messageData.messageType || "text",
      phoneNumberId: messageData.phoneNumberId,
      config: JSON.parse(JSON.stringify(messageData.config)),
      audioId: messageData.audioId,
      audioMimeType: messageData.audioMimeType,
      timestamp: Date.now(),
    }

    await redisClient.lpush(bufferKey, JSON.stringify(bufferedMessage))
    // Buffer expires after 5 minutes
    await redisClient.expire(bufferKey, 300)

    // Check if timer exists - if not, set one
    const timerExists = await redisClient.exists(timerKey)
    if (!timerExists) {
      logger.debug("MSG-BUFFER", `🕐 Iniciando timer de debounce para: ${userPhoneNumber}`)
      // Set a marker that a timer is active (doesn't matter the value, just needs to exist)
      await redisClient.setex(timerKey, Math.ceil(BUFFER_DEBOUNCE_MS / 1000), "1")

      // Wait for debounce period before processing
      setTimeout(async () => {
        await flushMessageBuffer(userPhoneNumber)
      }, BUFFER_DEBOUNCE_MS)
    } else {
      logger.debug("MSG-BUFFER", `⏳ Agregando a buffer existente: ${userPhoneNumber}`)
    }
  } catch (error) {
    logger.error("MSG-BUFFER", `Error agregando a buffer: ${userPhoneNumber}`, error)
  }
}

export async function getBufferedMessages(userPhoneNumber: string): Promise<BufferedMessage[]> {
  const redisClient = getRedisClient()
  if (!redisClient) {
    return []
  }

  try {
    const bufferKey = `${BUFFER_KEY_PREFIX}${userPhoneNumber}`
    const messages = await redisClient.lrange(bufferKey, 0, -1)

    if (!messages || messages.length === 0) {
      return []
    }

    const bufferedMessages: BufferedMessage[] = []
    for (const msg of messages) {
      try {
        if (typeof msg === "string") {
          bufferedMessages.push(JSON.parse(msg))
        }
      } catch (parseError) {
        logger.warn("MSG-BUFFER", `Error parseando mensaje del buffer`)
      }
    }

    // Return messages in reverse chronological order (oldest first)
    return bufferedMessages.reverse()
  } catch (error) {
    logger.error("MSG-BUFFER", `Error obteniendo buffer: ${userPhoneNumber}`, error)
    return []
  }
}

export async function flushMessageBuffer(userPhoneNumber: string): Promise<BufferedMessage[]> {
  const redisClient = getRedisClient()
  if (!redisClient) {
    return []
  }

  try {
    const bufferKey = `${BUFFER_KEY_PREFIX}${userPhoneNumber}`
    const timerKey = `${BUFFER_TIMER_PREFIX}${userPhoneNumber}`

    const messages = await getBufferedMessages(userPhoneNumber)

    if (messages.length > 0) {
      logger.info("MSG-BUFFER", `✓ Procesando buffer de ${messages.length} mensajes para: ${userPhoneNumber}`)

      // Clear the buffer and timer
      await redisClient.del(bufferKey)
      await redisClient.del(timerKey)

      // Import here to avoid circular dependency
      const { processUserBuffer } = await import("./whatsapp")

      // Process the buffered messages
      await processUserBuffer(userPhoneNumber)
    } else {
      logger.debug("MSG-BUFFER", `Buffer vacío para: ${userPhoneNumber}`)
      // Still clear the timer key so a new buffer can be started if needed
      await redisClient.del(timerKey)
    }

    return messages
  } catch (error) {
    logger.error("MSG-BUFFER", `Error limpiando buffer: ${userPhoneNumber}`, error)
    return []
  }
}

export async function clearBuffer(userPhoneNumber: string): Promise<void> {
  const redisClient = getRedisClient()
  if (!redisClient) {
    return
  }

  try {
    const bufferKey = `${BUFFER_KEY_PREFIX}${userPhoneNumber}`
    const timerKey = `${BUFFER_TIMER_PREFIX}${userPhoneNumber}`

    await redisClient.del(bufferKey)
    await redisClient.del(timerKey)

    logger.debug("MSG-BUFFER", `Buffer limpiado: ${userPhoneNumber}`)
  } catch (error) {
    logger.error("MSG-BUFFER", `Error limpiando buffer: ${userPhoneNumber}`, error)
  }
}

