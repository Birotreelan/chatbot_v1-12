import { kv } from "@vercel/kv"
import { logError } from "./monitoring"
import type { WhatsAppConfig, ThreadInfo, ConversationMessage } from "./types"

// Función para obtener configuración de WhatsApp por phoneNumberId
export async function getWhatsAppConfigByPhoneId(phoneNumberId: string): Promise<WhatsAppConfig | null> {
  try {
    console.log(`[DB] Buscando configuración para phoneNumberId: ${phoneNumberId}`)

    // Obtener todas las configuraciones
    const configs = (await kv.get<WhatsAppConfig[]>("whatsapp_configs")) || []

    // Buscar la configuración que coincida con el phoneNumberId
    const config = configs.find((c) => c.phoneNumberId === phoneNumberId && c.isActive)

    if (config) {
      console.log(`[DB] ✅ Configuración encontrada: ${config.displayName} (${config.id})`)
      return config
    } else {
      console.log(`[DB] ❌ No se encontró configuración activa para phoneNumberId: ${phoneNumberId}`)
      return null
    }
  } catch (error) {
    console.error(`[DB] Error obteniendo configuración por phoneNumberId:`, error)
    await logError("get_whatsapp_config_by_phone_id", error instanceof Error ? error : new Error(String(error)))
    return null
  }
}

// Función para obtener configuración de WhatsApp por ID
export async function getWhatsAppConfig(configId: string): Promise<WhatsAppConfig | null> {
  try {
    console.log(`[DB] Buscando configuración por ID: ${configId}`)

    const configs = (await kv.get<WhatsAppConfig[]>("whatsapp_configs")) || []
    const config = configs.find((c) => c.id === configId)

    if (config) {
      console.log(`[DB] ✅ Configuración encontrada: ${config.displayName}`)
      return config
    } else {
      console.log(`[DB] ❌ No se encontró configuración con ID: ${configId}`)
      return null
    }
  } catch (error) {
    console.error(`[DB] Error obteniendo configuración:`, error)
    await logError("get_whatsapp_config", error instanceof Error ? error : new Error(String(error)))
    return null
  }
}

// Función para obtener todas las configuraciones de WhatsApp
export async function getAllWhatsAppConfigs(): Promise<WhatsAppConfig[]> {
  try {
    const configs = (await kv.get<WhatsAppConfig[]>("whatsapp_configs")) || []
    return configs.filter((c) => c.isActive)
  } catch (error) {
    console.error(`[DB] Error obteniendo todas las configuraciones:`, error)
    await logError("get_all_whatsapp_configs", error instanceof Error ? error : new Error(String(error)))
    return []
  }
}

// Función para guardar configuración de WhatsApp
export async function saveWhatsAppConfig(
  config: Omit<WhatsAppConfig, "createdAt" | "updatedAt">,
): Promise<WhatsAppConfig> {
  try {
    const now = new Date()
    const fullConfig: WhatsAppConfig = {
      ...config,
      createdAt: now,
      updatedAt: now,
    }

    const configs = (await kv.get<WhatsAppConfig[]>("whatsapp_configs")) || []
    const existingIndex = configs.findIndex((c) => c.id === config.id)

    if (existingIndex >= 0) {
      configs[existingIndex] = { ...configs[existingIndex], ...fullConfig, updatedAt: now }
    } else {
      configs.push(fullConfig)
    }

    await kv.set("whatsapp_configs", configs)
    console.log(`[DB] ✅ Configuración guardada: ${config.displayName}`)

    return fullConfig
  } catch (error) {
    console.error(`[DB] Error guardando configuración:`, error)
    await logError("save_whatsapp_config", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

// Función para actualizar estadísticas de WhatsApp
export async function updateWhatsAppStats(
  configId: string,
  stats: {
    messagesReceived?: number
    messagesProcessed?: number
    errors?: number
  },
): Promise<void> {
  try {
    const key = `whatsapp_stats:${configId}`
    const currentStats = (await kv.get<any>(key)) || {
      messagesReceived: 0,
      messagesProcessed: 0,
      errors: 0,
      lastUpdated: new Date(),
    }

    const updatedStats = {
      messagesReceived: currentStats.messagesReceived + (stats.messagesReceived || 0),
      messagesProcessed: currentStats.messagesProcessed + (stats.messagesProcessed || 0),
      errors: currentStats.errors + (stats.errors || 0),
      lastUpdated: new Date(),
    }

    await kv.set(key, updatedStats, { ex: 86400 * 30 }) // 30 días
    console.log(`[DB] ✅ Estadísticas actualizadas para config ${configId}`)
  } catch (error) {
    console.error(`[DB] Error actualizando estadísticas:`, error)
    await logError("update_whatsapp_stats", error instanceof Error ? error : new Error(String(error)))
  }
}

// Función para obtener o crear thread para un usuario
export async function getThreadForUser(phoneNumber: string, configId: string): Promise<ThreadInfo> {
  try {
    const key = `thread:${phoneNumber}:${configId}`
    let threadData = await kv.get<{ threadId: string; createdAt: string }>(key)

    let isNewThread = false
    let isResetThread = false

    if (!threadData) {
      // Crear nuevo thread
      const threadId = `thread_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      threadData = {
        threadId,
        createdAt: new Date().toISOString(),
      }

      await kv.set(key, threadData, { ex: 86400 * 7 }) // 7 días
      isNewThread = true
      console.log(`[DB] ✅ Nuevo thread creado: ${threadId}`)
    } else {
      // Verificar si el thread es muy antiguo (más de 24 horas)
      const createdAt = new Date(threadData.createdAt)
      const now = new Date()
      const hoursDiff = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60)

      if (hoursDiff > 24) {
        // Resetear thread
        const threadId = `thread_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        threadData = {
          threadId,
          createdAt: new Date().toISOString(),
        }

        await kv.set(key, threadData, { ex: 86400 * 7 })
        isResetThread = true
        console.log(`[DB] ✅ Thread reseteado: ${threadId}`)
      } else {
        console.log(`[DB] ✅ Thread existente: ${threadData.threadId}`)
      }
    }

    return {
      threadId: threadData.threadId,
      isNewThread,
      isResetThread,
    }
  } catch (error) {
    console.error(`[DB] Error obteniendo/creando thread:`, error)
    await logError("get_thread_for_user", error instanceof Error ? error : new Error(String(error)))

    // Fallback: crear thread temporal
    const fallbackThreadId = `fallback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    return {
      threadId: fallbackThreadId,
      isNewThread: true,
      isResetThread: false,
    }
  }
}

// Función para guardar mensaje de conversación
export async function saveConversationMessage(
  phoneNumber: string,
  configId: string,
  clienteId: string,
  message: string,
  direction: "incoming" | "outgoing",
  threadId?: string,
  userName?: string,
): Promise<string> {
  try {
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    const conversationMessage: ConversationMessage = {
      id: messageId,
      phoneNumber,
      configId,
      clienteId,
      message,
      direction,
      threadId,
      userName,
      timestamp: new Date(),
    }

    // Guardar mensaje individual
    const messageKey = `conversation_message:${messageId}`
    await kv.set(messageKey, conversationMessage, { ex: 86400 * 7 }) // 7 días

    // Agregar a la lista de mensajes del usuario
    const userMessagesKey = `user_messages:${phoneNumber}:${configId}`
    const userMessages = (await kv.get<string[]>(userMessagesKey)) || []
    userMessages.push(messageId)

    // Mantener solo los últimos 100 mensajes
    if (userMessages.length > 100) {
      const oldMessageIds = userMessages.splice(0, userMessages.length - 100)
      // Eliminar mensajes antiguos
      for (const oldId of oldMessageIds) {
        await kv.del(`conversation_message:${oldId}`)
      }
    }

    await kv.set(userMessagesKey, userMessages, { ex: 86400 * 7 })

    // Agregar a la lista de conversaciones del cliente
    const clientConversationsKey = `client_conversations:${clienteId}`
    const conversations = (await kv.get<string[]>(clientConversationsKey)) || []
    const conversationId = `${phoneNumber}:${configId}`

    if (!conversations.includes(conversationId)) {
      conversations.push(conversationId)
      await kv.set(clientConversationsKey, conversations, { ex: 86400 * 7 })
    }

    console.log(`[DB] ✅ Mensaje guardado: ${messageId} (${direction})`)
    return messageId
  } catch (error) {
    console.error(`[DB] Error guardando mensaje:`, error)
    await logError("save_conversation_message", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

// Función para obtener conversaciones por cliente
export async function getConversationsByClient(clienteId: string): Promise<any[]> {
  try {
    const clientConversationsKey = `client_conversations:${clienteId}`
    const conversationIds = (await kv.get<string[]>(clientConversationsKey)) || []

    const conversations = []

    for (const conversationId of conversationIds) {
      const [phoneNumber, configId] = conversationId.split(":")

      // Obtener los últimos mensajes de esta conversación
      const userMessagesKey = `user_messages:${phoneNumber}:${configId}`
      const messageIds = (await kv.get<string[]>(userMessagesKey)) || []

      if (messageIds.length > 0) {
        // Obtener el último mensaje
        const lastMessageId = messageIds[messageIds.length - 1]
        const lastMessage = await kv.get<ConversationMessage>(`conversation_message:${lastMessageId}`)

        if (lastMessage) {
          conversations.push({
            id: conversationId,
            phoneNumber,
            configId,
            userName: lastMessage.userName || phoneNumber,
            lastMessage: lastMessage.message,
            lastMessageTime: lastMessage.timestamp,
            messageCount: messageIds.length,
          })
        }
      }
    }

    // Ordenar por último mensaje
    conversations.sort((a, b) => new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime())

    return conversations
  } catch (error) {
    console.error(`[DB] Error obteniendo conversaciones por cliente:`, error)
    await logError("get_conversations_by_client", error instanceof Error ? error : new Error(String(error)))
    return []
  }
}

// Función para obtener mensajes de una conversación
export async function getConversationMessages(phoneNumber: string, configId: string): Promise<ConversationMessage[]> {
  try {
    const userMessagesKey = `user_messages:${phoneNumber}:${configId}`
    const messageIds = (await kv.get<string[]>(userMessagesKey)) || []

    const messages: ConversationMessage[] = []

    for (const messageId of messageIds) {
      const message = await kv.get<ConversationMessage>(`conversation_message:${messageId}`)
      if (message) {
        messages.push(message)
      }
    }

    // Ordenar por timestamp
    messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    return messages
  } catch (error) {
    console.error(`[DB] Error obteniendo mensajes de conversación:`, error)
    await logError("get_conversation_messages", error instanceof Error ? error : new Error(String(error)))
    return []
  }
}

// Función para obtener todos los clientes únicos
export async function getAllClients(): Promise<Array<{ clienteId: string; displayName: string }>> {
  try {
    const configs = await getAllWhatsAppConfigs()
    const clients = new Map<string, string>()

    for (const config of configs) {
      if (config.cliente_id) {
        clients.set(config.cliente_id, config.displayName)
      }
    }

    return Array.from(clients.entries()).map(([clienteId, displayName]) => ({
      clienteId,
      displayName,
    }))
  } catch (error) {
    console.error(`[DB] Error obteniendo clientes:`, error)
    await logError("get_all_clients", error instanceof Error ? error : new Error(String(error)))
    return []
  }
}
