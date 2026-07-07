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

// ─── Patient snapshot (para filtros en el panel de soporte) ──────────────────
// Cada vez que get_paciente resuelve un paciente para un teléfono, guardamos
// una copia liviana de sus datos identificatorios (HC, DNI, celular, nombre,
// apellido). Así el panel "Conversaciones generadas por IA" puede filtrar por
// esos campos sin tener que volver a consultar la API de la clínica.
const PATIENT_SNAPSHOT_PREFIX = "patient_snapshot:"
// Mismo TTL que la conversación: si la conversación expira, el snapshot también.
const PATIENT_SNAPSHOT_TTL = CONVERSATION_TTL

export interface PatientSnapshot {
  hc?: string
  nrodoc?: string
  celular?: string
  apellido?: string
  nombre?: string
  updatedAt: string
}

function patientSnapshotKey(configId: string, phoneNumber: string): string {
  return `${PATIENT_SNAPSHOT_PREFIX}${configId}:${phoneNumber}`
}

/**
 * Guarda/actualiza el snapshot de un paciente identificado para un contacto.
 * Se llama cada vez que get_paciente (bot) o get_paciente_interfaz (agente
 * humano) devuelven datos de un paciente para ese teléfono.
 */
export async function savePatientSnapshot(
  configId: string,
  phoneNumber: string,
  data: Omit<PatientSnapshot, "updatedAt">,
): Promise<void> {
  try {
    // No pisar el snapshot con datos vacíos (p.ej. una consulta que no trajo nada nuevo)
    const hasAnyValue = Object.values(data).some((v) => v !== undefined && v !== null && v !== "")
    if (!hasAnyValue) return

    const redisClient = getRedisClient()
    if (!redisClient) return

    const key = patientSnapshotKey(configId, phoneNumber)
    const snapshot: PatientSnapshot = {
      ...data,
      updatedAt: new Date().toISOString(),
    }
    await redisClient.set(key, JSON.stringify(snapshot))
    await redisClient.expire(key, PATIENT_SNAPSHOT_TTL)
  } catch (error) {
    console.error("[CONVERSATIONS] Error guardando patient snapshot:", error)
  }
}

/**
 * Trae los snapshots de paciente para un conjunto de teléfonos de un config,
 * en un solo round-trip (mget), para mergear con la lista de contactos.
 */
export async function getPatientSnapshots(
  configId: string,
  phoneNumbers: string[],
): Promise<Map<string, PatientSnapshot>> {
  const result = new Map<string, PatientSnapshot>()
  if (!phoneNumbers.length) return result

  try {
    const redisClient = getRedisClient()
    if (!redisClient) return result

    const keys = phoneNumbers.map((phone) => patientSnapshotKey(configId, phone))
    const values = await redisClient.mget<(string | null)[]>(...keys)
    values.forEach((value, index) => {
      if (!value) return
      try {
        const parsed: PatientSnapshot = typeof value === "string" ? JSON.parse(value) : (value as any)
        result.set(phoneNumbers[index], parsed)
      } catch {
        // ignorar snapshot corrupto
      }
    })
  } catch (error) {
    console.error("[CONVERSATIONS] Error obteniendo patient snapshots:", error)
  }

  return result
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
    // OPTIMIZACIÓN BANDWIDTH (2026-07-06): ya NO se invalida contacts_cache en cada
    // mensaje. Con tráfico activo el cache (TTL 60s) nunca llegaba a servir un hit y
    // cada poll del dashboard hacía SMEMBERS + MGET de TODOS los contactos + re-escritura
    // del cache completo. Ahora manda el TTL: la lista de contactos puede estar hasta
    // 60 segundos desactualizada, aceptable para una vista de monitoreo.
    const pipeline = redisClient.pipeline()
    pipeline.rpush(conversationKey, JSON.stringify(validatedMessage))
    pipeline.expire(conversationKey, CONVERSATION_TTL)
    pipeline.set(contactKey, JSON.stringify(contactInfo))
    pipeline.expire(contactKey, CONVERSATION_TTL)
    pipeline.sadd(contactsSetKey, message.phoneNumber)
    pipeline.expire(contactsSetKey, CONVERSATION_TTL)
    await pipeline.exec()
  } catch (error) {
    console.error("[CONVERSATIONS] Error guardando mensaje:", error)
  }
}

/**
 * Marcador de actividad barato para polling (2026-07-06): devuelve el timestamp del
 * último mensaje de la conversación leyendo SOLO el registro de contacto (~200 bytes),
 * sin traer los mensajes. Los endpoints de polling lo usan para responder "unchanged"
 * cuando no hay novedades, evitando transferir 50-150 KB por poll.
 */
export async function getConversationLastActivity(
  configId: string,
  phoneNumber: string,
): Promise<string | null> {
  try {
    const redisClient = getRedisClient()
    if (!redisClient) return null
    const contactKey = `${CONVERSATION_CONTACT_PREFIX}${configId}:${phoneNumber}`
    const contactData = await redisClient.get(contactKey)
    if (!contactData) return null
    const contact: any = typeof contactData === "string" ? JSON.parse(contactData) : contactData
    return contact?.lastMessageAt || null
  } catch {
    return null
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
