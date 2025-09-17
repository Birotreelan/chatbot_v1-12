import { Redis } from "@upstash/redis"
import { nanoid } from "nanoid"
import type { WhatsAppConfig, Conversation, ConversationMessage } from "./types"

// Obtener cliente Redis
function getRedisClient() {
  try {
    return Redis.fromEnv()
  } catch (error) {
    console.warn("Upstash Redis no está disponible:", error)
    return null
  }
}

// Configuraciones de WhatsApp
export async function createWhatsAppConfig(config: Omit<WhatsAppConfig, "id" | "createdAt" | "updatedAt" | "stats">) {
  const redis = getRedisClient()
  if (!redis) throw new Error("Redis no disponible")

  const id = nanoid()
  const now = new Date().toISOString()

  const newConfig: WhatsAppConfig = {
    ...config,
    id,
    createdAt: now,
    updatedAt: now,
    stats: {
      messagesReceived: 0,
      messagesProcessed: 0,
      errors: 0,
    },
  }

  await redis.set(`whatsapp_config:${id}`, JSON.stringify(newConfig))
  await redis.sadd("whatsapp_configs", id)

  console.log(`[DB] ✅ Configuración ${id} creada exitosamente`)
  return newConfig
}

export async function getWhatsAppConfig(id: string): Promise<WhatsAppConfig | null> {
  const redis = getRedisClient()
  if (!redis) return null

  console.log(`[DB] 🔍 Obteniendo configuración ${id}`)
  console.log(`[DB] 🔍 Buscando en Redis con clave: whatsapp_config:${id}`)

  try {
    const data = await redis.get(`whatsapp_config:${id}`)
    if (!data) {
      console.log(`[DB] ❌ Configuración ${id} no encontrada`)
      return null
    }

    console.log(`[DB] 📄 Datos encontrados en Redis, deserializando...`)
    const config = typeof data === "string" ? JSON.parse(data) : data
    console.log(`[DB] ✅ Configuración ${id} obtenida exitosamente`)
    console.log(`[DB] - displayName: ${config.displayName}`)
    console.log(`[DB] - cliente_id: ${config.cliente_id}`)

    return config as WhatsAppConfig
  } catch (error) {
    console.error(`[DB] ❌ Error obteniendo configuración ${id}:`, error)
    return null
  }
}

export async function getAllWhatsAppConfigs(): Promise<WhatsAppConfig[]> {
  const redis = getRedisClient()
  if (!redis) return []

  try {
    const configIds = await redis.smembers("whatsapp_configs")
    const configs: WhatsAppConfig[] = []

    for (const id of configIds) {
      const config = await getWhatsAppConfig(id)
      if (config) {
        configs.push(config)
      }
    }

    return configs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  } catch (error) {
    console.error("[DB] Error obteniendo configuraciones:", error)
    return []
  }
}

export async function updateWhatsAppConfig(id: string, updates: Partial<WhatsAppConfig>) {
  const redis = getRedisClient()
  if (!redis) throw new Error("Redis no disponible")

  const existing = await getWhatsAppConfig(id)
  if (!existing) throw new Error("Configuración no encontrada")

  const updated = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  }

  await redis.set(`whatsapp_config:${id}`, JSON.stringify(updated))
  console.log(`[DB] ✅ Configuración ${id} actualizada exitosamente`)
  return updated
}

export async function updateWhatsAppStats(configId: string, stats: Partial<WhatsAppConfig["stats"]>) {
  console.log(`[DB] 🔄 Actualizando configuración ${configId} con:`, { stats })

  const existing = await getWhatsAppConfig(configId)
  if (!existing) {
    console.error(`[DB] ❌ Configuración ${configId} no encontrada para actualizar stats`)
    return
  }

  const updatedStats = {
    ...existing.stats,
    ...stats,
  }

  await updateWhatsAppConfig(configId, { stats: updatedStats })
}

export async function deleteWhatsAppConfig(id: string) {
  const redis = getRedisClient()
  if (!redis) throw new Error("Redis no disponible")

  await redis.del(`whatsapp_config:${id}`)
  await redis.srem("whatsapp_configs", id)

  console.log(`[DB] ✅ Configuración ${id} eliminada exitosamente`)
}

export async function getWhatsAppConfigByPhoneNumberId(phoneNumberId: string): Promise<WhatsAppConfig | null> {
  const configs = await getAllWhatsAppConfigs()
  return configs.find((config) => config.phoneNumberId === phoneNumberId) || null
}

// Gestión de threads
export async function getThreadForUser(phoneNumber: string, configId: string) {
  const redis = getRedisClient()
  if (!redis) throw new Error("Redis no disponible")

  const threadKey = `thread:${phoneNumber}:${configId}`
  console.log(`[DB] 🔍 Obteniendo thread para ${phoneNumber} con config ${configId}`)

  try {
    let threadData = await redis.get(threadKey)

    if (!threadData) {
      // Crear nuevo thread
      console.log(`[DB] 📝 Creando nuevo thread para ${phoneNumber}`)
      const response = await fetch("https://api.openai.com/v1/threads", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "assistants=v2",
        },
      })

      if (!response.ok) {
        throw new Error(`Error creando thread: ${response.status}`)
      }

      const thread = await response.json()
      threadData = {
        threadId: thread.id,
        createdAt: new Date().toISOString(),
        resetCount: 0,
      }

      await redis.set(threadKey, JSON.stringify(threadData), { ex: 60 * 60 * 24 * 7 }) // 7 días
      console.log(`[DB] ✅ Nuevo thread creado: ${thread.id}`)

      return {
        threadId: thread.id,
        isNewThread: true,
        isResetThread: false,
      }
    }

    const parsed = typeof threadData === "string" ? JSON.parse(threadData) : threadData
    console.log(`[DB] ✅ Thread encontrado: ${parsed.threadId}`)

    return {
      threadId: parsed.threadId,
      isNewThread: false,
      isResetThread: false,
    }
  } catch (error) {
    console.error(`[DB] ❌ Error gestionando thread:`, error)
    throw error
  }
}

// Conversaciones
export async function getOrCreateConversation(
  phoneNumber: string,
  userName: string,
  configId: string,
  clienteId: string,
  clienteName: string,
  threadId: string,
): Promise<Conversation> {
  const redis = getRedisClient()
  if (!redis) throw new Error("Redis no disponible")

  const conversationKey = `conversation:${phoneNumber}:${configId}`
  console.log(`[DB] 🔍 Obteniendo conversación para ${phoneNumber}`)

  try {
    const conversationData = await redis.get(conversationKey)

    if (!conversationData) {
      // Crear nueva conversación
      console.log(`[DB] 📝 Creando nueva conversación: ${conversationKey}`)
      const conversation: Conversation = {
        id: conversationKey,
        phoneNumber,
        userName,
        configId,
        clienteId,
        clienteName,
        threadId,
        lastMessage: "",
        lastMessageAt: new Date().toISOString(),
        messageCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      await redis.set(conversationKey, JSON.stringify(conversation), { ex: 60 * 60 * 24 * 7 }) // 7 días
      await redis.sadd("conversations", conversationKey)
      console.log(`[DB] ✅ Nueva conversación creada: ${conversationKey}`)

      return conversation
    }

    const parsed = typeof conversationData === "string" ? JSON.parse(conversationData) : conversationData
    console.log(`[DB] ✅ Conversación encontrada: ${conversationKey}`)

    return parsed as Conversation
  } catch (error) {
    console.error(`[DB] ❌ Error gestionando conversación:`, error)
    throw error
  }
}

export async function addMessageToConversation(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  messageId?: string,
) {
  const redis = getRedisClient()
  if (!redis) throw new Error("Redis no disponible")

  console.log(`[DB] 💬 Agregando mensaje a conversación ${conversationId}`)

  try {
    // Crear mensaje
    const message: ConversationMessage = {
      id: nanoid(),
      conversationId,
      role,
      content,
      messageId,
      createdAt: new Date().toISOString(),
    }

    // Guardar mensaje
    const messageKey = `message:${conversationId}:${message.id}`
    await redis.set(messageKey, JSON.stringify(message), { ex: 60 * 60 * 24 * 7 }) // 7 días
    await redis.sadd(`messages:${conversationId}`, message.id)

    // Actualizar conversación
    const conversation = await redis.get(conversationId)
    if (conversation) {
      const parsed = typeof conversation === "string" ? JSON.parse(conversation) : conversation
      parsed.lastMessage = content.substring(0, 100) + (content.length > 100 ? "..." : "")
      parsed.lastMessageAt = new Date().toISOString()
      parsed.messageCount = (parsed.messageCount || 0) + 1
      parsed.updatedAt = new Date().toISOString()

      await redis.set(conversationId, JSON.stringify(parsed), { ex: 60 * 60 * 24 * 7 })
    }

    console.log(`[DB] ✅ Mensaje agregado a conversación ${conversationId}`)
  } catch (error) {
    console.error(`[DB] ❌ Error agregando mensaje:`, error)
    throw error
  }
}

export async function getAllConversations(): Promise<Conversation[]> {
  const redis = getRedisClient()
  if (!redis) return []

  try {
    const conversationIds = await redis.smembers("conversations")
    const conversations: Conversation[] = []

    for (const id of conversationIds) {
      const data = await redis.get(id)
      if (data) {
        const parsed = typeof data === "string" ? JSON.parse(data) : data
        conversations.push(parsed as Conversation)
      }
    }

    return conversations.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
  } catch (error) {
    console.error("[DB] Error obteniendo conversaciones:", error)
    return []
  }
}

export async function getConversationsByClient(clienteId: string): Promise<Conversation[]> {
  const allConversations = await getAllConversations()
  return allConversations.filter((conv) => conv.clienteId === clienteId)
}

export async function getConversationMessages(conversationId: string): Promise<ConversationMessage[]> {
  const redis = getRedisClient()
  if (!redis) return []

  try {
    const messageIds = await redis.smembers(`messages:${conversationId}`)
    const messages: ConversationMessage[] = []

    for (const id of messageIds) {
      const data = await redis.get(`message:${conversationId}:${id}`)
      if (data) {
        const parsed = typeof data === "string" ? JSON.parse(data) : data
        messages.push(parsed as ConversationMessage)
      }
    }

    return messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  } catch (error) {
    console.error("[DB] Error obteniendo mensajes de conversación:", error)
    return []
  }
}

// Limpieza de datos antiguos
export async function cleanupOldConversations(daysOld = 7) {
  const redis = getRedisClient()
  if (!redis) return { deleted: 0 }

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysOld)

  try {
    const conversationIds = await redis.smembers("conversations")
    let deleted = 0

    for (const id of conversationIds) {
      const data = await redis.get(id)
      if (data) {
        const parsed = typeof data === "string" ? JSON.parse(data) : data
        const createdAt = new Date(parsed.createdAt)

        if (createdAt < cutoffDate) {
          // Eliminar mensajes de la conversación
          const messageIds = await redis.smembers(`messages:${id}`)
          for (const messageId of messageIds) {
            await redis.del(`message:${id}:${messageId}`)
          }
          await redis.del(`messages:${id}`)

          // Eliminar conversación
          await redis.del(id)
          await redis.srem("conversations", id)
          deleted++
        }
      }
    }

    console.log(`[DB] ✅ Limpieza completada: ${deleted} conversaciones eliminadas`)
    return { deleted }
  } catch (error) {
    console.error("[DB] Error en limpieza de conversaciones:", error)
    return { deleted: 0 }
  }
}

// Función para compatibilidad con el webhook
export const getWhatsAppConfigByPhoneId = getWhatsAppConfigByPhoneNumberId
