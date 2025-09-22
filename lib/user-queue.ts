import { getRedisClient } from "./redis"
import { processIndividualMessage } from "./whatsapp-processor"

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
  console.log(`[USER-QUEUE] Encolando mensaje para usuario ${userPhoneNumber}`)

  const redisClient = getRedisClient()
  if (!redisClient) {
    console.warn("[USER-QUEUE] Redis no disponible, procesando directamente")
    // Si Redis no está disponible, procesar directamente
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
    // Crear el objeto del mensaje con timestamp
    const queuedMessage: QueuedMessage = {
      userMessage: messageData.userMessage,
      messageType: messageData.messageType || "text",
      phoneNumberId: messageData.phoneNumberId,
      // Serializar el objeto config para evitar problemas con objetos circulares
      config: JSON.parse(JSON.stringify(messageData.config)),
      timestamp: Date.now(),
    }

    // Serializar correctamente el mensaje antes de guardarlo
    const serializedMessage = JSON.stringify(queuedMessage)
    console.log(`[USER-QUEUE] Mensaje serializado: ${serializedMessage.substring(0, 100)}...`)

    // Añadir el mensaje a la cola del usuario
    const queueKey = `user_queue:${userPhoneNumber}`
    await redisClient.lpush(queueKey, serializedMessage)

    // Establecer TTL para la cola (24 horas)
    await redisClient.expire(queueKey, 24 * 60 * 60)

    console.log(`[USER-QUEUE] Mensaje añadido a la cola de ${userPhoneNumber}`)

    // Procesar la cola si no se está procesando ya
    await processUserQueue(userPhoneNumber)
  } catch (error) {
    console.error(`[USER-QUEUE] Error al encolar mensaje para ${userPhoneNumber}:`, error)
    // Fallback: procesar directamente si hay error con Redis
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
  // Verificar si ya se está procesando este usuario
  if (processingUsers.has(userPhoneNumber)) {
    console.log(`[USER-QUEUE] Usuario ${userPhoneNumber} ya está siendo procesado`)
    return
  }

  const redisClient = getRedisClient()
  if (!redisClient) {
    console.warn("[USER-QUEUE] Redis no disponible para procesar cola")
    return
  }

  // Marcar usuario como en procesamiento
  processingUsers.add(userPhoneNumber)

  try {
    console.log(`[USER-QUEUE] Iniciando procesamiento de cola para ${userPhoneNumber}`)

    const queueKey = `user_queue:${userPhoneNumber}`

    while (true) {
      // Obtener el siguiente mensaje de la cola
      const rawMessage = await redisClient.rpop(queueKey)

      if (!rawMessage) {
        // No hay más mensajes en la cola
        console.log(`[USER-QUEUE] Cola vacía para usuario ${userPhoneNumber}`)
        break
      }

      try {
        // Manejar diferentes tipos de datos que puede devolver Redis
        let serializedMessage: string

        console.log(`[USER-QUEUE] Tipo de mensaje recuperado: ${typeof rawMessage}`)
        console.log(`[USER-QUEUE] Mensaje crudo:`, rawMessage)

        if (typeof rawMessage === "string") {
          serializedMessage = rawMessage
        } else if (typeof rawMessage === "object" && rawMessage !== null) {
          // Si Redis devuelve un objeto, intentar convertirlo
          if (Array.isArray(rawMessage)) {
            console.error(`[USER-QUEUE] Mensaje es un array, saltando:`, rawMessage)
            continue
          }

          // Si el objeto ya tiene la estructura correcta, usarlo directamente
          if (rawMessage.userMessage && rawMessage.phoneNumberId && rawMessage.config) {
            console.log(`[USER-QUEUE] Objeto ya tiene estructura válida, procesando directamente`)
            await processIndividualMessage(
              rawMessage.userMessage,
              rawMessage.phoneNumberId,
              rawMessage.config,
              userPhoneNumber,
              rawMessage.messageType || "text",
            )
            console.log(`[USER-QUEUE] Mensaje procesado exitosamente para ${userPhoneNumber}`)
            continue
          }

          // Intentar serializar el objeto
          try {
            serializedMessage = JSON.stringify(rawMessage)
          } catch (serializeError) {
            console.error(`[USER-QUEUE] Error al serializar objeto:`, serializeError)
            continue
          }
        } else {
          console.error(`[USER-QUEUE] Tipo de mensaje no soportado: ${typeof rawMessage}`)
          continue
        }

        console.log(`[USER-QUEUE] Mensaje a parsear: ${serializedMessage.substring(0, 100)}...`)

        // Parsear el mensaje
        let queuedMessage: QueuedMessage
        try {
          queuedMessage = JSON.parse(serializedMessage)
        } catch (parseError) {
          console.error(`[USER-QUEUE] Error al parsear mensaje:`, parseError)
          console.error(`[USER-QUEUE] Mensaje problemático:`, serializedMessage)
          continue
        }

        // Validar que el mensaje tiene la estructura correcta
        if (!queuedMessage.userMessage || !queuedMessage.phoneNumberId || !queuedMessage.config) {
          console.error(`[USER-QUEUE] Mensaje con estructura inválida:`, queuedMessage)
          continue
        }

        console.log(
          `[USER-QUEUE] Procesando mensaje de ${userPhoneNumber}: "${queuedMessage.userMessage}" (tipo: ${queuedMessage.messageType || "text"})`,
        )

        // Procesar el mensaje
        await processIndividualMessage(
          queuedMessage.userMessage,
          queuedMessage.phoneNumberId,
          queuedMessage.config,
          userPhoneNumber,
          queuedMessage.messageType || "text",
        )

        console.log(`[USER-QUEUE] Mensaje procesado exitosamente para ${userPhoneNumber}`)
      } catch (error) {
        console.error(`[USER-QUEUE] Error al procesar mensaje de ${userPhoneNumber}:`, error)
        // Continuar con el siguiente mensaje en caso de error
      }

      // Pequeña pausa entre mensajes para evitar sobrecarga
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  } catch (error) {
    console.error(`[USER-QUEUE] Error al procesar cola de ${userPhoneNumber}:`, error)
  } finally {
    // Remover usuario del conjunto de procesamiento
    processingUsers.delete(userPhoneNumber)
    console.log(`[USER-QUEUE] Procesamiento completado para usuario ${userPhoneNumber}`)
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

// Agregar función para limpiar colas existentes
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
