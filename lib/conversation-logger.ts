import { Redis } from "@upstash/redis"
import type { Conversation, ConversationMessage, ConversationStats } from "./types"
import { nanoid } from "nanoid"

// Inicializar el cliente de Redis
let redis: Redis | null = null

function getRedisClient() {
  if (redis) return redis

  try {
    redis = Redis.fromEnv()
    console.log("[CONVERSATION] ✅ Cliente Redis inicializado correctamente")
    return redis
  } catch (error) {
    console.warn("[CONVERSATION] ⚠️ Upstash Redis no está disponible:", error)
    return null
  }
}

// Almacenamiento en memoria como fallback
const memoryStorage = {
  conversations: new Map<string, Conversation>(),
  messages: new Map<string, ConversationMessage[]>(),
  phoneToConversation: new Map<string, string>(),
}

// Prefijos para las claves en Redis
const CONVERSATION_PREFIX = "conversation:"
const MESSAGES_PREFIX = "messages:"
const PHONE_TO_CONVERSATION_PREFIX = "phone_to_conversation:"
const CONVERSATION_STATS_KEY = "conversation_stats"

// Función auxiliar para manejar la serialización/deserialización segura
function safeJsonParse(data: any): any {
  if (typeof data === "string") {
    try {
      return JSON.parse(data)
    } catch (error) {
      console.error("[CONVERSATION] Error al parsear JSON:", error)
      return null
    }
  }
  return data
}

// Crear o obtener una conversación existente
export async function getOrCreateConversation(
  phoneNumber: string,
  whatsappConfigId: string,
  threadId: string,
  userName?: string,
  configDisplayName?: string,
): Promise<Conversation> {
  const redisClient = getRedisClient()
  const phoneKey = `${phoneNumber}:${whatsappConfigId}`

  console.log(`[CONVERSATION] 🔍 Buscando conversación para ${phoneNumber}`)

  // Intentar obtener conversación existente
  let conversationId: string | null = null

  if (redisClient) {
    conversationId = (await redisClient.get(`${PHONE_TO_CONVERSATION_PREFIX}${phoneKey}`)) as string
  } else {
    conversationId = memoryStorage.phoneToConversation.get(phoneKey) || null
  }

  if (conversationId) {
    // Obtener conversación existente
    let conversation: Conversation | null = null

    if (redisClient) {
      const conversationData = await redisClient.get(`${CONVERSATION_PREFIX}${conversationId}`)
      conversation = safeJsonParse(conversationData)
    } else {
      conversation = memoryStorage.conversations.get(conversationId) || null
    }

    if (conversation) {
      console.log(`[CONVERSATION] ✅ Conversación existente encontrada: ${conversationId}`)

      // Actualizar última actividad
      const updatedConversation = {
        ...conversation,
        lastMessageAt: new Date().toISOString(),
        status: "active" as const,
        threadId, // Actualizar threadId en caso de que haya cambiado
      }

      if (redisClient) {
        await redisClient.set(`${CONVERSATION_PREFIX}${conversationId}`, JSON.stringify(updatedConversation))
      } else {
        memoryStorage.conversations.set(conversationId, updatedConversation)
      }

      return updatedConversation
    }
  }

  // Crear nueva conversación
  const newConversationId = nanoid()
  const now = new Date().toISOString()

  const newConversation: Conversation = {
    id: newConversationId,
    phoneNumber,
    userName,
    whatsappConfigId,
    configDisplayName,
    threadId,
    startedAt: now,
    lastMessageAt: now,
    messageCount: 0,
    status: "active",
    tags: [],
  }

  console.log(`[CONVERSATION] 📝 Creando nueva conversación: ${newConversationId}`)

  if (redisClient) {
    await redisClient.set(`${CONVERSATION_PREFIX}${newConversationId}`, JSON.stringify(newConversation))
    await redisClient.set(`${PHONE_TO_CONVERSATION_PREFIX}${phoneKey}`, newConversationId)
  } else {
    memoryStorage.conversations.set(newConversationId, newConversation)
    memoryStorage.phoneToConversation.set(phoneKey, newConversationId)
  }

  // Actualizar estadísticas
  await updateConversationStats()

  return newConversation
}

// Registrar un mensaje en una conversación
export async function logMessage(
  conversationId: string,
  sender: "user" | "assistant",
  message: string,
  metadata?: {
    whatsappMessageId?: string
    assistantId?: string
    functionCalls?: string[]
    processingTime?: number
  },
): Promise<ConversationMessage> {
  const messageId = nanoid()
  const timestamp = new Date().toISOString()

  const conversationMessage: ConversationMessage = {
    id: messageId,
    conversationId,
    sender,
    message,
    timestamp,
    messageType: "text",
    metadata,
  }

  console.log(`[CONVERSATION] 💬 Registrando mensaje ${sender} en conversación ${conversationId}`)

  const redisClient = getRedisClient()

  if (redisClient) {
    // Obtener mensajes existentes
    const existingMessagesData = await redisClient.get(`${MESSAGES_PREFIX}${conversationId}`)
    const existingMessages = safeJsonParse(existingMessagesData) || []

    // Agregar nuevo mensaje
    const updatedMessages = [...existingMessages, conversationMessage]

    // Guardar mensajes actualizados
    await redisClient.set(`${MESSAGES_PREFIX}${conversationId}`, JSON.stringify(updatedMessages))
  } else {
    // Fallback a memoria
    const existingMessages = memoryStorage.messages.get(conversationId) || []
    const updatedMessages = [...existingMessages, conversationMessage]
    memoryStorage.messages.set(conversationId, updatedMessages)
  }

  // Actualizar contador de mensajes en la conversación
  await updateConversationMessageCount(conversationId)

  return conversationMessage
}

// Actualizar contador de mensajes en una conversación
async function updateConversationMessageCount(conversationId: string): Promise<void> {
  const redisClient = getRedisClient()

  if (redisClient) {
    const conversationData = await redisClient.get(`${CONVERSATION_PREFIX}${conversationId}`)
    const conversation = safeJsonParse(conversationData)

    if (conversation) {
      const updatedConversation = {
        ...conversation,
        messageCount: conversation.messageCount + 1,
        lastMessageAt: new Date().toISOString(),
      }

      await redisClient.set(`${CONVERSATION_PREFIX}${conversationId}`, JSON.stringify(updatedConversation))
    }
  } else {
    const conversation = memoryStorage.conversations.get(conversationId)
    if (conversation) {
      const updatedConversation = {
        ...conversation,
        messageCount: conversation.messageCount + 1,
        lastMessageAt: new Date().toISOString(),
      }
      memoryStorage.conversations.set(conversationId, updatedConversation)
    }
  }
}

// Obtener todas las conversaciones
export async function getAllConversations(): Promise<Conversation[]> {
  const redisClient = getRedisClient()

  if (redisClient) {
    const keys = await redisClient.keys(`${CONVERSATION_PREFIX}*`)

    if (keys.length === 0) return []

    const conversations = await Promise.all(
      keys.map(async (key) => {
        const conversationData = await redisClient.get(key)
        return safeJsonParse(conversationData)
      }),
    )

    return conversations.filter(Boolean) as Conversation[]
  } else {
    return Array.from(memoryStorage.conversations.values())
  }
}

// Obtener mensajes de una conversación
export async function getConversationMessages(conversationId: string): Promise<ConversationMessage[]> {
  const redisClient = getRedisClient()

  if (redisClient) {
    const messagesData = await redisClient.get(`${MESSAGES_PREFIX}${conversationId}`)
    return safeJsonParse(messagesData) || []
  } else {
    return memoryStorage.messages.get(conversationId) || []
  }
}

// Obtener una conversación por ID
export async function getConversationById(conversationId: string): Promise<Conversation | null> {
  const redisClient = getRedisClient()

  if (redisClient) {
    const conversationData = await redisClient.get(`${CONVERSATION_PREFIX}${conversationId}`)
    return safeJsonParse(conversationData)
  } else {
    return memoryStorage.conversations.get(conversationId) || null
  }
}

// Actualizar estadísticas de conversaciones
export async function updateConversationStats(): Promise<ConversationStats> {
  const conversations = await getAllConversations()

  const stats: ConversationStats = {
    totalConversations: conversations.length,
    activeConversations: conversations.filter((c) => c.status === "active").length,
    totalMessages: conversations.reduce((sum, c) => sum + c.messageCount, 0),
    averageMessagesPerConversation:
      conversations.length > 0
        ? Math.round(conversations.reduce((sum, c) => sum + c.messageCount, 0) / conversations.length)
        : 0,
    lastUpdated: new Date().toISOString(),
  }

  const redisClient = getRedisClient()

  if (redisClient) {
    await redisClient.set(CONVERSATION_STATS_KEY, JSON.stringify(stats))
  }

  return stats
}

// Obtener estadísticas de conversaciones
export async function getConversationStats(): Promise<ConversationStats> {
  const redisClient = getRedisClient()

  if (redisClient) {
    const statsData = await redisClient.get(CONVERSATION_STATS_KEY)
    const stats = safeJsonParse(statsData)

    if (!stats) {
      return updateConversationStats()
    }

    return stats
  } else {
    return updateConversationStats()
  }
}

// Archivar conversaciones inactivas (más de 24 horas sin actividad)
export async function archiveInactiveConversations(): Promise<number> {
  const conversations = await getAllConversations()
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  let archivedCount = 0
  const redisClient = getRedisClient()

  for (const conversation of conversations) {
    if (conversation.status === "active" && conversation.lastMessageAt < oneDayAgo) {
      const updatedConversation = {
        ...conversation,
        status: "inactive" as const,
      }

      if (redisClient) {
        await redisClient.set(`${CONVERSATION_PREFIX}${conversation.id}`, JSON.stringify(updatedConversation))
      } else {
        memoryStorage.conversations.set(conversation.id, updatedConversation)
      }

      archivedCount++
    }
  }

  if (archivedCount > 0) {
    await updateConversationStats()
    console.log(`[CONVERSATION] 📦 Archivadas ${archivedCount} conversaciones inactivas`)
  }

  return archivedCount
}
