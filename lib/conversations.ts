import { getRedisClient } from "./redis"

// Prefijos para las claves en Redis
const CONVERSATION_PREFIX = "conversation:"
const CONVERSATION_CONTACT_PREFIX = "conversation_contact:"
const CONVERSATION_CONTACTS_SET_PREFIX = "conversation_contacts:"

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
    console.log(`[CONVERSATIONS] ✅ Mensaje guardado con TTL de 7 días`)

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
export async function getConversationContacts(configId: string): Promise<ConversationContact[]> {
  try {
    const redisClient = getRedisClient()
    if (!redisClient) {
      console.warn("[CONVERSATIONS] Redis no disponible")
      return []
    }

    const contactsSetKey = `${CONVERSATION_CONTACTS_SET_PREFIX}${configId}`

    console.log(`[CONVERSATIONS] 📇 Obteniendo contactos:`)
    console.log(`[CONVERSATIONS]   - configId: ${configId}`)
    console.log(`[CONVERSATIONS]   - contactsSetKey: ${contactsSetKey}`)

    // Obtener todos los números de teléfono del set
    const phoneNumbers = await redisClient.smembers(contactsSetKey)

    console.log(`[CONVERSATIONS] 📊 Números de teléfono en set:`, phoneNumbers)

    if (!phoneNumbers || phoneNumbers.length === 0) {
      console.log(`[CONVERSATIONS] ⚠️ No hay contactos para configId: ${configId}`)
      return []
    }

    console.log(`[CONVERSATIONS] 📊 Total de números: ${phoneNumbers.length}`)

    // Obtener la información de cada contacto
    const contacts: ConversationContact[] = []
    for (const phoneNumber of phoneNumbers) {
      try {
        const contactKey = `${CONVERSATION_CONTACT_PREFIX}${configId}:${phoneNumber}`
        console.log(`[CONVERSATIONS] 📱 Obteniendo contacto: ${contactKey}`)

        const contactData = await redisClient.get(contactKey)
        console.log(`[CONVERSATIONS]   - Data raw:`, contactData)
        console.log(`[CONVERSATIONS]   - Data type:`, typeof contactData)

        if (!contactData) {
          console.log(`[CONVERSATIONS]   - ⚠️ No hay datos para ${phoneNumber}`)
          continue
        }

        let contact: any
        if (typeof contactData === "string") {
          console.log(`[CONVERSATIONS]   - Parseando string JSON`)
          contact = JSON.parse(contactData)
        } else if (typeof contactData === "object") {
          console.log(`[CONVERSATIONS]   - Ya es un objeto, usando directamente`)
          contact = contactData
        } else {
          console.log(`[CONVERSATIONS]   - ⚠️ Tipo de dato inesperado: ${typeof contactData}`)
          continue
        }

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
        console.error(`[CONVERSATIONS] ❌ Error procesando contacto ${phoneNumber}:`, error)
      }
    }

    console.log(`[CONVERSATIONS] ✅ Total contactos procesados: ${contacts.length}`)

    // Ordenar por fecha del último mensaje
    contacts.sort((a, b) => {
      try {
        const dateA = new Date(a.lastMessageAt).getTime()
        const dateB = new Date(b.lastMessageAt).getTime()

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
    console.error("[CONVERSATIONS] ❌ Error actualizando contador:", error)
  }
}
