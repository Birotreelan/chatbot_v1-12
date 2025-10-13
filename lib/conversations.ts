import { getRedisClient } from "./redis"

// Prefijos para las claves en Redis
const CONVERSATION_PREFIX = "conversation:"
const CONVERSATION_LIST_PREFIX = "conversation_list:"

// Duración de almacenamiento: 7 días en segundos
const CONVERSATION_TTL = 7 * 24 * 60 * 60 // 7 días

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

    const validatedMessage = {
      ...message,
      timestamp: ensureValidTimestamp(message.timestamp),
    }

    const conversationKey = `${CONVERSATION_PREFIX}${message.configId}:${message.phoneNumber}`
    const listKey = `${CONVERSATION_LIST_PREFIX}${message.configId}`

    console.log(
      `[CONVERSATIONS] Guardando mensaje: ${message.phoneNumber} (${message.role}) - timestamp: ${validatedMessage.timestamp}`,
    )

    // Guardar el mensaje en la lista de conversación
    await redisClient.rpush(conversationKey, JSON.stringify(validatedMessage))

    // Establecer TTL de 7 días
    await redisClient.expire(conversationKey, CONVERSATION_TTL)

    // Actualizar la lista de contactos
    const contactInfo: ConversationContact = {
      phoneNumber: message.phoneNumber, // Asegurar que phoneNumber esté en el objeto
      lastMessage: message.content.substring(0, 100),
      lastMessageAt: validatedMessage.timestamp,
      messageCount: 1,
      configId: message.configId,
    }

    // Guardar en un hash para acceso rápido
    await redisClient.hset(listKey, message.phoneNumber, JSON.stringify(contactInfo))
    await redisClient.expire(listKey, CONVERSATION_TTL)

    console.log(`[CONVERSATIONS] ✅ Mensaje guardado: ${message.phoneNumber} (${message.role})`)
  } catch (error) {
    console.error("[CONVERSATIONS] ❌ Error guardando mensaje:", error)
  }
}

// Obtener todos los mensajes de una conversación
export async function getConversationMessages(configId: string, phoneNumber: string): Promise<ConversationMessage[]> {
  try {
    const redisClient = getRedisClient()
    if (!redisClient) {
      console.warn("[CONVERSATIONS] Redis no disponible")
      return []
    }

    const conversationKey = `${CONVERSATION_PREFIX}${configId}:${phoneNumber}`
    const messages = await redisClient.lrange(conversationKey, 0, -1)

    console.log(`[CONVERSATIONS] Obteniendo mensajes: ${phoneNumber} - ${messages.length} mensajes`)

    return messages.map((msg) => {
      const parsed = JSON.parse(msg as string)
      return {
        ...parsed,
        timestamp: ensureValidTimestamp(parsed.timestamp),
      }
    })
  } catch (error) {
    console.error("[CONVERSATIONS] ❌ Error obteniendo mensajes:", error)
    return []
  }
}

// Obtener todos los contactos de un cliente
export async function getConversationContacts(configId: string): Promise<ConversationContact[]> {
  try {
    const redisClient = getRedisClient()
    if (!redisClient) {
      console.warn("[CONVERSATIONS] Redis no disponible")
      return []
    }

    const listKey = `${CONVERSATION_LIST_PREFIX}${configId}`
    const contactsData = await redisClient.hgetall(listKey)

    if (!contactsData) {
      console.log(`[CONVERSATIONS] No hay contactos para configId: ${configId}`)
      return []
    }

    const contacts: ConversationContact[] = []
    for (const [phoneNumber, data] of Object.entries(contactsData)) {
      try {
        const contact = JSON.parse(data as string)
        contacts.push({
          phoneNumber: contact.phoneNumber || phoneNumber, // Usar la clave del hash si no está en el objeto
          lastMessage: contact.lastMessage || "",
          lastMessageAt: ensureValidTimestamp(contact.lastMessageAt),
          messageCount: contact.messageCount || 0,
          configId: contact.configId || configId,
        })
      } catch (error) {
        console.error(`[CONVERSATIONS] ❌ Error parseando contacto ${phoneNumber}:`, error)
      }
    }

    console.log(`[CONVERSATIONS] Contactos obtenidos: ${contacts.length} para configId: ${configId}`)

    contacts.sort((a, b) => {
      try {
        const dateA = new Date(a.lastMessageAt).getTime()
        const dateB = new Date(b.lastMessageAt).getTime()

        // If either date is invalid, put it at the end
        if (isNaN(dateA)) return 1
        if (isNaN(dateB)) return -1

        return dateB - dateA
      } catch (error) {
        console.error(`[CONVERSATIONS] ❌ Error ordenando contactos:`, error)
        return 0
      }
    })

    return contacts
  } catch (error) {
    console.error("[CONVERSATIONS] ❌ Error obteniendo contactos:", error)
    return []
  }
}

// Actualizar el contador de mensajes de un contacto
export async function updateContactMessageCount(configId: string, phoneNumber: string): Promise<void> {
  try {
    const redisClient = getRedisClient()
    if (!redisClient) return

    const listKey = `${CONVERSATION_LIST_PREFIX}${configId}`
    const contactData = await redisClient.hget(listKey, phoneNumber)

    if (contactData) {
      const contact = JSON.parse(contactData as string)
      contact.messageCount = (contact.messageCount || 0) + 1
      contact.lastMessageAt = ensureValidTimestamp(contact.lastMessageAt)
      await redisClient.hset(listKey, phoneNumber, JSON.stringify(contact))
    }
  } catch (error) {
    console.error("[CONVERSATIONS] ❌ Error actualizando contador:", error)
  }
}
