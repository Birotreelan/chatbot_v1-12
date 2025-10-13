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

// Guardar un mensaje en la conversación
export async function saveConversationMessage(message: ConversationMessage): Promise<void> {
  try {
    const redisClient = getRedisClient()
    if (!redisClient) {
      console.warn("[CONVERSATIONS] Redis no disponible, no se puede guardar mensaje")
      return
    }

    const conversationKey = `${CONVERSATION_PREFIX}${message.configId}:${message.phoneNumber}`
    const listKey = `${CONVERSATION_LIST_PREFIX}${message.configId}`

    // Guardar el mensaje en la lista de conversación
    await redisClient.rpush(conversationKey, JSON.stringify(message))

    // Establecer TTL de 7 días
    await redisClient.expire(conversationKey, CONVERSATION_TTL)

    // Actualizar la lista de contactos
    const contactInfo: ConversationContact = {
      phoneNumber: message.phoneNumber,
      lastMessage: message.content.substring(0, 100),
      lastMessageAt: message.timestamp,
      messageCount: 1,
      configId: message.configId,
    }

    // Guardar en un hash para acceso rápido
    await redisClient.hset(listKey, message.phoneNumber, JSON.stringify(contactInfo))
    await redisClient.expire(listKey, CONVERSATION_TTL)

    console.log(`[CONVERSATIONS] Mensaje guardado: ${message.phoneNumber} (${message.role})`)
  } catch (error) {
    console.error("[CONVERSATIONS] Error guardando mensaje:", error)
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

    return messages.map((msg) => JSON.parse(msg as string))
  } catch (error) {
    console.error("[CONVERSATIONS] Error obteniendo mensajes:", error)
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
      return []
    }

    const contacts: ConversationContact[] = []
    for (const [phoneNumber, data] of Object.entries(contactsData)) {
      try {
        const contact = JSON.parse(data as string)
        contacts.push(contact)
      } catch (error) {
        console.error(`[CONVERSATIONS] Error parseando contacto ${phoneNumber}:`, error)
      }
    }

    // Ordenar por última actividad
    contacts.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())

    return contacts
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

    const listKey = `${CONVERSATION_LIST_PREFIX}${configId}`
    const contactData = await redisClient.hget(listKey, phoneNumber)

    if (contactData) {
      const contact = JSON.parse(contactData as string)
      contact.messageCount = (contact.messageCount || 0) + 1
      await redisClient.hset(listKey, phoneNumber, JSON.stringify(contact))
    }
  } catch (error) {
    console.error("[CONVERSATIONS] Error actualizando contador:", error)
  }
}
