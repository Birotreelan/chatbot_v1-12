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

    console.log(`[CONVERSATIONS] 💾 Guardando mensaje:`)
    console.log(`[CONVERSATIONS]   - phoneNumber: ${message.phoneNumber}`)
    console.log(`[CONVERSATIONS]   - role: ${message.role}`)
    console.log(`[CONVERSATIONS]   - content: ${message.content.substring(0, 50)}...`)
    console.log(`[CONVERSATIONS]   - timestamp: ${validatedMessage.timestamp}`)
    console.log(`[CONVERSATIONS]   - configId: ${message.configId}`)
    console.log(`[CONVERSATIONS]   - conversationKey: ${conversationKey}`)
    console.log(`[CONVERSATIONS]   - listKey: ${listKey}`)

    // Guardar el mensaje en la lista de conversación
    await redisClient.rpush(conversationKey, JSON.stringify(validatedMessage))
    console.log(`[CONVERSATIONS] ✅ Mensaje agregado a lista en Redis`)

    // Establecer TTL de 7 días
    await redisClient.expire(conversationKey, CONVERSATION_TTL)
    console.log(`[CONVERSATIONS] ⏰ TTL establecido: ${CONVERSATION_TTL}s (7 días)`)

    // Actualizar la lista de contactos
    const contactInfo: ConversationContact = {
      phoneNumber: message.phoneNumber,
      lastMessage: message.content.substring(0, 100),
      lastMessageAt: validatedMessage.timestamp,
      messageCount: 1,
      configId: message.configId,
    }

    console.log(`[CONVERSATIONS] 📇 Actualizando contacto:`, JSON.stringify(contactInfo, null, 2))

    // Guardar en un hash para acceso rápido
    await redisClient.hset(listKey, message.phoneNumber, JSON.stringify(contactInfo))
    await redisClient.expire(listKey, CONVERSATION_TTL)

    console.log(`[CONVERSATIONS] ✅ Contacto actualizado en hash`)
    console.log(`[CONVERSATIONS] ✅ Mensaje guardado completamente`)
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

    console.log(`[CONVERSATIONS] 📖 Obteniendo mensajes:`)
    console.log(`[CONVERSATIONS]   - configId: ${configId}`)
    console.log(`[CONVERSATIONS]   - phoneNumber: ${phoneNumber}`)
    console.log(`[CONVERSATIONS]   - conversationKey: ${conversationKey}`)

    const messages = await redisClient.lrange(conversationKey, 0, -1)

    console.log(`[CONVERSATIONS] 📊 Mensajes en Redis: ${messages.length}`)

    if (messages.length > 0) {
      console.log(`[CONVERSATIONS] 📝 Primer mensaje raw:`, messages[0])
      console.log(`[CONVERSATIONS] 📝 Último mensaje raw:`, messages[messages.length - 1])
    }

    const parsedMessages = messages
      .map((msg, index) => {
        try {
          const parsed = JSON.parse(msg as string)
          console.log(`[CONVERSATIONS] 📄 Mensaje ${index + 1}/${messages.length}:`, {
            role: parsed.role,
            phoneNumber: parsed.phoneNumber,
            timestamp: parsed.timestamp,
            contentLength: parsed.content?.length || 0,
          })
          return {
            ...parsed,
            timestamp: ensureValidTimestamp(parsed.timestamp),
          }
        } catch (parseError) {
          console.error(`[CONVERSATIONS] ❌ Error parseando mensaje ${index}:`, parseError)
          return null
        }
      })
      .filter(Boolean)

    console.log(`[CONVERSATIONS] ✅ Mensajes parseados: ${parsedMessages.length}`)

    return parsedMessages
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

    console.log(`[CONVERSATIONS] 📇 Obteniendo contactos:`)
    console.log(`[CONVERSATIONS]   - configId: ${configId}`)
    console.log(`[CONVERSATIONS]   - listKey: ${listKey}`)

    const contactsData = await redisClient.hgetall(listKey)

    console.log(`[CONVERSATIONS] 📊 Datos raw de Redis:`, contactsData)

    if (!contactsData || Object.keys(contactsData).length === 0) {
      console.log(`[CONVERSATIONS] ⚠️ No hay contactos para configId: ${configId}`)
      return []
    }

    console.log(`[CONVERSATIONS] 📊 Número de contactos en hash: ${Object.keys(contactsData).length}`)

    const contacts: ConversationContact[] = []
    for (const [phoneNumber, data] of Object.entries(contactsData)) {
      try {
        console.log(`[CONVERSATIONS] 📱 Procesando contacto ${phoneNumber}:`)
        console.log(`[CONVERSATIONS]   - Data raw:`, data)

        const contact = JSON.parse(data as string)
        console.log(`[CONVERSATIONS]   - Data parseada:`, contact)

        const processedContact = {
          phoneNumber: contact.phoneNumber || phoneNumber,
          lastMessage: contact.lastMessage || "",
          lastMessageAt: ensureValidTimestamp(contact.lastMessageAt),
          messageCount: contact.messageCount || 0,
          configId: contact.configId || configId,
        }

        console.log(`[CONVERSATIONS]   - Contacto procesado:`, processedContact)
        contacts.push(processedContact)
      } catch (error) {
        console.error(`[CONVERSATIONS] ❌ Error parseando contacto ${phoneNumber}:`, error)
      }
    }

    console.log(`[CONVERSATIONS] ✅ Total contactos procesados: ${contacts.length}`)

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
