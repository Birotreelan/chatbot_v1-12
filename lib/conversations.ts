import { getRedisClient } from "./redis"

// Prefijos para las claves en Redis
const CONVERSATION_PREFIX = "conversation:"
const CONVERSATION_CONTACT_PREFIX = "conversation_contact:"
const CONVERSATION_CONTACTS_SET_PREFIX = "conversation_contacts:"
const CONVERSATION_PAUSED_PREFIX = "conversation_paused:"

// Duración de almacenamiento: 15 días en segundos
const CONVERSATION_TTL = 15 * 24 * 60 * 60 // 15 días

const contactsCache = new Map<string, { contacts: ConversationContact[]; timestamp: number }>()
const CACHE_TTL = 30000 // 30 segundos de caché

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
    console.log(`[CONVERSATIONS] 🔵 ===== INICIO saveConversationMessage =====`)
    console.log(`[CONVERSATIONS] 🔵 Mensaje recibido:`, JSON.stringify(message, null, 2))

    const redisClient = getRedisClient()
    if (!redisClient) {
      console.warn("[CONVERSATIONS] Redis no disponible, no se puede guardar mensaje")
      return
    }

    console.log(`[CONVERSATIONS] ✅ Cliente Redis obtenido`)

    const validatedMessage = {
      ...message,
      timestamp: ensureValidTimestamp(message.timestamp),
    }

    console.log(`[CONVERSATIONS] ✅ Mensaje validado:`, JSON.stringify(validatedMessage, null, 2))

    // Claves para almacenamiento
    const conversationKey = `${CONVERSATION_PREFIX}${message.configId}:${message.phoneNumber}`
    const contactKey = `${CONVERSATION_CONTACT_PREFIX}${message.configId}:${message.phoneNumber}`
    const contactsSetKey = `${CONVERSATION_CONTACTS_SET_PREFIX}${message.configId}`

    console.log(`[CONVERSATIONS] 🔑 Claves generadas:`)
    console.log(`[CONVERSATIONS]   - conversationKey: ${conversationKey}`)
    console.log(`[CONVERSATIONS]   - contactKey: ${contactKey}`)
    console.log(`[CONVERSATIONS]   - contactsSetKey: ${contactsSetKey}`)

    // 1. Guardar el mensaje en la lista de conversación
    console.log(`[CONVERSATIONS] 📝 Guardando mensaje en lista...`)
    const messageString = JSON.stringify(validatedMessage)
    console.log(
      `[CONVERSATIONS] 📝 Mensaje serializado (${messageString.length} chars):`,
      messageString.substring(0, 200),
    )

    await redisClient.rpush(conversationKey, messageString)
    await redisClient.expire(conversationKey, CONVERSATION_TTL)
    console.log(`[CONVERSATIONS] ✅ Mensaje guardado con TTL de 15 días`)

    // 2. Actualizar información del contacto
    const contactInfo: ConversationContact = {
      phoneNumber: message.phoneNumber,
      lastMessage: message.content.substring(0, 100),
      lastMessageAt: validatedMessage.timestamp,
      messageCount: 1,
      configId: message.configId,
    }

    console.log(`[CONVERSATIONS] 📇 Objeto contactInfo creado:`, JSON.stringify(contactInfo, null, 2))

    const contactString = JSON.stringify(contactInfo)
    console.log(`[CONVERSATIONS] 📇 contactInfo serializado (${contactString.length} chars):`, contactString)

    // Usar SET en lugar de HSET para evitar problemas de parsing
    console.log(`[CONVERSATIONS] 💾 Guardando contacto con SET en clave: ${contactKey}`)
    await redisClient.set(contactKey, contactString)
    await redisClient.expire(contactKey, CONVERSATION_TTL)
    console.log(`[CONVERSATIONS] ✅ Contacto guardado con SET`)

    // Verificar que se guardó correctamente
    const verifyValue = await redisClient.get(contactKey)
    console.log(`[CONVERSATIONS] 🔍 Verificando valor guardado:`, verifyValue)
    console.log(`[CONVERSATIONS] 🔍 Tipo de valor guardado:`, typeof verifyValue)

    // 3. Agregar el número de teléfono al set de contactos
    await redisClient.sadd(contactsSetKey, message.phoneNumber)
    await redisClient.expire(contactsSetKey, CONVERSATION_TTL)
    console.log(`[CONVERSATIONS] ✅ Número agregado al set de contactos`)

    contactsCache.delete(message.configId)

    console.log(`[CONVERSATIONS] 🟢 ===== FIN saveConversationMessage (EXITOSO) =====`)
  } catch (error) {
    console.error("[CONVERSATIONS] 🔴 ===== ERROR en saveConversationMessage =====")
    console.error("[CONVERSATIONS] ❌ Error guardando mensaje:", error)
    console.error("[CONVERSATIONS] ❌ Stack:", error.stack)
    console.error("[CONVERSATIONS] 🔴 ===== FIN ERROR =====")
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
      console.log(`[CONVERSATIONS] 📝 Tipo del primer mensaje:`, typeof messages[0])
      console.log(`[CONVERSATIONS] 📝 Último mensaje raw:`, messages[messages.length - 1])
    }

    const parsedMessages = messages
      .map((msg, index) => {
        try {
          let parsed: any

          // Verificar si ya es un objeto o si es un string que necesita parsing
          if (typeof msg === "string") {
            console.log(`[CONVERSATIONS] 📄 Mensaje ${index + 1}: parseando string JSON`)
            parsed = JSON.parse(msg)
          } else if (typeof msg === "object" && msg !== null) {
            console.log(`[CONVERSATIONS] 📄 Mensaje ${index + 1}: ya es un objeto, usando directamente`)
            parsed = msg
          } else {
            console.log(`[CONVERSATIONS] ⚠️ Mensaje ${index + 1}: tipo inesperado ${typeof msg}`)
            return null
          }

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
export async function getConversationContacts(
  configId: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<ConversationContact[]> {
  try {
    const cached = contactsCache.get(configId)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL && !dateFrom && !dateTo) {
      return cached.contacts
    }

    const redisClient = getRedisClient()
    if (!redisClient) {
      console.warn("[CONVERSATIONS] Redis no disponible")
      return []
    }

    const contactsSetKey = `${CONVERSATION_CONTACTS_SET_PREFIX}${configId}`

    // Obtener todos los números de teléfono del set
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
          let contact: any
          if (typeof contactData === "string") {
            contact = JSON.parse(contactData)
          } else if (typeof contactData === "object") {
            contact = contactData
          } else {
            return null
          }

          return {
            phoneNumber: contact.phoneNumber || phoneNumbers[index],
            lastMessage: contact.lastMessage || "",
            lastMessageAt: ensureValidTimestamp(contact.lastMessageAt),
            messageCount: contact.messageCount || 0,
            configId: contact.configId || configId,
          }
        } catch (error) {
          console.error(`[CONVERSATIONS] Error procesando contacto:`, error)
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

          // Establecer la hora al inicio o al final del día para una comparación adecuada
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
        } catch (error) {
          return false
        }
      })
    }

    // Ordenar por fecha del último mensaje
    filteredContacts.sort((a, b) => {
      try {
        const dateA = new Date(a.lastMessageAt).getTime()
        const dateB = new Date(b.lastMessageAt).getTime()

        if (isNaN(dateA)) return 1
        if (isNaN(dateB)) return -1

        return dateB - dateA
      } catch (error) {
        return 0
      }
    })

    // Solo almacenar en caché si no se aplican filtros de fecha
    if (!dateFrom && !dateTo) {
      contactsCache.set(configId, { contacts: filteredContacts, timestamp: Date.now() })
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
