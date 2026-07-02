import { getRedisClient } from "./redis"

// Prefijos para las claves en Redis
const CONVERSATION_PREFIX = "conversation:"
const CONVERSATION_CONTACT_PREFIX = "conversation_contact:"
const CONVERSATION_CONTACTS_SET_PREFIX = "conversation_contacts:"
const CONVERSATION_PAUSED_PREFIX = "conversation_paused:"

// Duración de almacenamiento: 7 días en segundos (reducido de 15 para optimizar bandwidth)
const CONVERSATION_TTL = 7 * 24 * 60 * 60 // 7 días

// OPTIMIZACIÓN: cache de contactos en Redis (TTL 60s) en lugar de Map en memoria.
// En Vercel serverless cada invocación es una instancia nueva — el Map nunca se reutiliza.
// Con Redis el cache es compartido entre todas las instancias.
const CONTACTS_CACHE_TTL_SECONDS = 60
const CONTACTS_CACHE_KEY_PREFIX = "contacts_cache:"

export interface ConversationMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: string
  phoneNumber: string
  configId: string
  messageType?: string
}

export interface ConversationContact {
  phoneNumber: string
  lastMessage: string
  lastMessageAt: string
  messageCount: number
  configId: string
}

function ensureValidTimestamp(timestamp: any): string {
  if (!timestamp) {
    return new Date().toISOString()
  }

  const date = new Date(timestamp)
  if (isNaN(date.getTime())) {
    console.warn(`[CONVERSATIONS] Invalid timestamp: ${timestamp}, using current time`)
    return new Date().toISOString()
  }

  return date.toISOString()
}

// Guardar un mensaje en la conversación
export async function saveConversationMessage(message: ConversationMessage): Promise<void> {
  try {
    const redisClient = getRedisClient()
    if (!redisClient) {
      console.warn("[CONVERSATIONS] Redis no disponible, no se puede guardar mensaje")
      return
    }

    // Truncar contenido largo antes de almacenar
    // Template-context blocks y mensajes de sistema pueden ser 3-5 KB cada uno.
    const MAX_CONTENT_LENGTH = 1000
    const rawContent = message.content || ""
    const truncatedContent = rawContent.length > MAX_CONTENT_LENGTH
      ? rawContent.substring(0, MAX_CONTENT_LENGTH) + "…[truncado]"
      : rawContent

    const validatedMessage = {
      ...message,
      content: truncatedContent,
      timestamp: ensureValidTimestamp(message.timestamp),
    }

    const conversationKey = `${CONVERSATION_PREFIX}${message.configId}:${message.phoneNumber}`
    const contactKey = `${CONVERSATION_CONTACT_PREFIX}${message.configId}:${message.phoneNumber}`
    const contactsSetKey = `${CONVERSATION_CONTACTS_SET_PREFIX}${message.configId}`

    const contactInfo: ConversationContact = {
      phoneNumber: message.phoneNumber,
      lastMessage: message.content.substring(0, 100),
      lastMessageAt: validatedMessage.timestamp,
      messageCount: 1,
      configId: message.configId,
    }

    // Pipeline: 6 comandos en 1 request HTTP (rpush, expire, set, expire, sadd, expire)
    // + invalidar cache de contactos Redis
    const pipeline = redisClient.pipeline()
    pipeline.rpush(conversationKey, JSON.stringify(validatedMessage))
    pipeline.expire(conversationKey, CONVERSATION_TTL)
    pipeline.set(contactKey, JSON.stringify(contactInfo))
    pipeline.expire(contactKey, CONVERSATION_TTL)
    pipeline.sadd(contactsSetKey, message.phoneNumber)
    pipeline.expire(contactsSetKey, CONVERSATION_TTL)
    // Invalidar cache Redis de contactos para este configId
    pipeline.del(`${CONTACTS_CACHE_KEY_PREFIX}${message.configId}`)
    await pipeline.exec()
  } catch (error) {
    console.error("[CONVERSATIONS] Error guardando mensaje:", error)
  }
}

// Obtener mensajes de una conversación con paginación para optimizar bandwidth
export async function getConversationMessages(
  configId: string, 
  phoneNumber: string,
  limit: number = 50,
  offset: number = 0
): Promise<{ messages: ConversationMessage[]; total: number; hasMore: boolean }> {
  try {
    const redisClient = getRedisClient()
    if (!redisClient) {
      console.warn("[CONVERSATIONS] Redis no disponible")
      return { messages: [], total: 0, hasMore: false }
    }

    const conversationKey = `${CONVERSATION_PREFIX}${configId}:${phoneNumber}`

    console.log(`[CONVERSATIONS] Obteniendo mensajes: ${configId}:${phoneNumber} (limit: ${limit}, offset: ${offset})`)

    // Obtener el total de mensajes primero (operacion ligera)
    const total = await redisClient.llen(conversationKey)
    
    // Calcular indices para paginacion (mensajes mas recientes primero)
    // Redis LRANGE es 0-indexed, queremos los ultimos mensajes
    const start = Math.max(0, total - offset - limit)
    const end = total - offset - 1
    
    // Si el offset es mayor que el total, no hay mas mensajes
    if (offset >= total) {
      return { messages: [], total, hasMore: false }
    }

    const messages = await redisClient.lrange(conversationKey, start, end)

    console.log(`[CONVERSATIONS] Mensajes obtenidos: ${messages.length} de ${total} total`)

    const parsedMessages = messages
      .map((msg, index) => {
        try {
          let parsed: any

          if (typeof msg === "string") {
            parsed = JSON.parse(msg)
          } else if (typeof msg === "object" && msg !== null) {
            parsed = msg
          } else {
            return null
          }

          return {
            ...parsed,
            timestamp: ensureValidTimestamp(parsed.timestamp),
          }
        } catch (parseError) {
          console.error(`[CONVERSATIONS] Error parseando mensaje ${index}:`, parseError)
          return null
        }
      })
      .filter(Boolean)

    const hasMore = offset + parsedMessages.length < total

    return { messages: parsedMessages, total, hasMore }
  } catch (error) {
    console.error("[CONVERSATIONS] Error obteniendo mensajes:", error)
    return { messages: [], total: 0, hasMore: false }
  }
}

// Funcion de compatibilidad para obtener todos los mensajes (usar con cuidado - alto bandwidth)
export async function getAllConversationMessages(configId: string, phoneNumber: string): Promise<ConversationMessage[]> {
  const result = await getConversationMessages(configId, phoneNumber, 10000, 0)
  return result.messages
}

// Obtener todos los contactos de un cliente
// OPTIMIZACIÓN: cache en Redis (TTL 60s) compartido entre instancias serverless.
// Sin filtros de fecha → sirve del cache. Con filtros → siempre va a Redis.
export async function getConversationContacts(
  configId: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<ConversationContact[]> {
  try {
    const redisClient = getRedisClient()
    if (!redisClient) {
      console.warn("[CONVERSATIONS] Redis no disponible")
      return []
    }

    // Cache Redis: solo sin filtros de fecha
    if (!dateFrom && !dateTo) {
      const cacheKey = `${CONTACTS_CACHE_KEY_PREFIX}${configId}`
      try {
        const cached = await redisClient.get(cacheKey)
        if (cached) {
          const parsed = typeof cached === "string" ? JSON.parse(cached) : cached
          if (Array.isArray(parsed)) return parsed as ConversationContact[]
        }
      } catch {
        // cache miss — continuar con lectura normal
      }
    }

    const contactsSetKey = `${CONVERSATION_CONTACTS_SET_PREFIX}${configId}`
    const phoneNumbers = await redisClient.smembers(contactsSetKey)

    if (!phoneNumbers || phoneNumbers.length === 0) {
      return []
    }

    const contactKeys = phoneNumbers.map((phone) => `${CONVERSATION_CONTACT_PREFIX}${configId}:${phone}`)
    const contactsData = await redisClient.mget(...contactKeys)

    const contacts: ConversationContact[] = contactsData
      .map((contactData, index) => {
        if (!contactData) return null
        try {
          const contact: any = typeof contactData === "string" ? JSON.parse(contactData) : contactData
          return {
            phoneNumber: contact.phoneNumber || phoneNumbers[index],
            lastMessage: contact.lastMessage || "",
            lastMessageAt: ensureValidTimestamp(contact.lastMessageAt),
            messageCount: contact.messageCount || 0,
            configId: contact.configId || configId,
          }
        } catch {
          return null
        }
      })
      .filter((contact): contact is ConversationContact => contact !== null)

    // Filtrar por rango de fechas si se proporcionan
    let filteredContacts = contacts
    if (dateFrom || dateTo) {
      filteredContacts = contacts.filter((contact) => {
        try {
          const contactDate = new Date(contact.lastMessageAt)
          if (isNaN(contactDate.getTime())) return false
          if (dateFrom) {
            const fromDate = new Date(dateFrom)
            fromDate.setHours(0, 0, 0, 0)
            if (contactDate < fromDate) return false
          }
          if (dateTo) {
            const toDate = new Date(dateTo)
            toDate.setHours(23, 59, 59, 999)
            if (contactDate > toDate) return false
          }
          return true
        } catch {
          return false
        }
      })
    }

    // Ordenar por fecha del último mensaje
    filteredContacts.sort((a, b) => {
      const dateA = new Date(a.lastMessageAt).getTime()
      const dateB = new Date(b.lastMessageAt).getTime()
      if (isNaN(dateA)) return 1
      if (isNaN(dateB)) return -1
      return dateB - dateA
    })

    // Guardar en cache Redis solo sin filtros de fecha
    if (!dateFrom && !dateTo && redisClient) {
      try {
        const cacheKey = `${CONTACTS_CACHE_KEY_PREFIX}${configId}`
        await redisClient.setex(cacheKey, CONTACTS_CACHE_TTL_SECONDS, JSON.stringify(filteredContacts))
      } catch {
        // fallar silenciosamente — el cache es opcional
      }
    }

    return filteredContacts
  } catch (error) {
    console.error("[CONVERSATIONS] Error obteniendo contactos:", error)
    return []
  }
}

// Actualizar el contador de mensajes de un contacto
export async function updateContactMessageCount(configId: string, phoneNumber: string): Promise<void> {
  try {
    const redisClient = getRedisClient()
    if (!redisClient) return

    const contactKey = `${CONVERSATION_CONTACT_PREFIX}${configId}:${phoneNumber}`
    const contactData = await redisClient.get(contactKey)

    if (contactData) {
      const contact = JSON.parse(contactData as string)
      contact.messageCount = (contact.messageCount || 0) + 1
      contact.lastMessageAt = ensureValidTimestamp(contact.lastMessageAt)
      await redisClient.set(contactKey, JSON.stringify(contact))
      await redisClient.expire(contactKey, CONVERSATION_TTL)
    }
  } catch (error) {
    console.error("[CONVERSATIONS] Error actualizando contador:", error)
  }
}

export async function isConversationPaused(configId: string, phoneNumber: string): Promise<boolean> {
  try {
    const redisClient = getRedisClient()
    if (!redisClient) {
      console.warn("[CONVERSATIONS] Redis no disponible, asumiendo no pausado")
      return false
    }

    const pauseKey = `${CONVERSATION_PAUSED_PREFIX}${configId}:${phoneNumber}`
    const isPaused = await redisClient.get(pauseKey)

    return isPaused === "1" || isPaused === true
  } catch (error) {
    console.error("[CONVERSATIONS] Error verificando estado de pausa:", error)
    return false
  }
}

export async function setConversationPaused(configId: string, phoneNumber: string, paused: boolean): Promise<boolean> {
  try {
    const redisClient = getRedisClient()
    if (!redisClient) {
      console.warn("[CONVERSATIONS] Redis no disponible, no se puede cambiar estado de pausa")
      return false
    }

    const pauseKey = `${CONVERSATION_PAUSED_PREFIX}${configId}:${phoneNumber}`

    if (paused) {
      // Pausar la conversación (sin TTL para que permanezca hasta que se reanude manualmente)
      await redisClient.set(pauseKey, "1")
      console.log(`[CONVERSATIONS] ⏸️ Conversación pausada: ${configId}:${phoneNumber}`)
    } else {
      // Reanudar la conversación
      await redisClient.del(pauseKey)
      console.log(`[CONVERSATIONS] ▶️ Conversación reanudada: ${configId}:${phoneNumber}`)
    }

    return true
  } catch (error) {
    console.error("[CONVERSATIONS] Error cambiando estado de pausa:", error)
    return false
  }
}

export async function getPausedConversations(configId: string): Promise<string[]> {
  try {
    const redisClient = getRedisClient()
    if (!redisClient) {
      return []
    }

    const pattern = `${CONVERSATION_PAUSED_PREFIX}${configId}:*`
    const keys = await scanRedisKeysConversations(redisClient, pattern)

    // Extraer los números de teléfono de las claves
    const prefix = `${CONVERSATION_PAUSED_PREFIX}${configId}:`
    return keys.map((key) => key.replace(prefix, ""))
  } catch (error) {
    console.error("[CONVERSATIONS] Error obteniendo conversaciones pausadas:", error)
    return []
  }
}

async function scanRedisKeysConversations(redisClient: any, pattern: string): Promise<string[]> {
  const allKeys: string[] = []
  let cursor = "0"

  do {
    const result = await redisClient.scan(cursor, {
      match: pattern,
      count: 100,
    })
    cursor = typeof result[0] === "number" ? result[0].toString() : result[0]
    allKeys.push(...result[1])
  } while (cursor !== "0")

  return allKeys
}
