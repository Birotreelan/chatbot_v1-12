import { getAllWhatsAppConfigs } from "./config" // Assuming config.ts is the file where getAllWhatsAppConfigs is declared

// Funciones para manejo de mensajes de conversaciones
export async function saveConversationMessage(
  phoneNumber: string,
  configId: string,
  clienteId: string,
  message: string,
  messageType: "incoming" | "outgoing",
  threadId?: string,
  userName?: string,
): Promise<string | null> {
  try {
    const redisClient = getRedisClient()
    if (!redisClient) {
      console.log("[DB] ⚠️ Redis no disponible, no se puede guardar el mensaje")
      return null
    }

    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const messageData = {
      id: messageId,
      phoneNumber,
      configId,
      clienteId,
      message,
      messageType,
      timestamp: new Date().toISOString(),
      threadId,
      userName,
      isFromUser: messageType === "incoming",
    }

    // Guardar mensaje individual con TTL de 7 días (604800 segundos)
    const messageKey = `conversation_message:${configId}:${phoneNumber}:${messageId}`
    await redisClient.setex(messageKey, 604800, JSON.stringify(messageData))

    // Actualizar resumen de conversación
    const summaryKey = `conversation_summary:${configId}:${phoneNumber}`
    const existingSummaryData = await redisClient.get(summaryKey)
    const existingSummary = safeJsonParse(existingSummaryData)

    const summary = existingSummary || {
      phoneNumber,
      configId,
      clienteId,
      userName,
      messageCount: 0,
      firstMessageAt: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
      lastMessage: "",
    }

    summary.messageCount += 1
    summary.lastMessageAt = new Date().toISOString()
    summary.lastMessage = message.substring(0, 100) + (message.length > 100 ? "..." : "")
    if (userName) summary.userName = userName

    await redisClient.setex(summaryKey, 604800, JSON.stringify(summary))

    console.log(`[DB] 💬 Mensaje guardado: ${messageType} para ${phoneNumber}`)
    return messageId
  } catch (error) {
    console.error("[DB] ❌ Error guardando mensaje:", error)
    return null
  }
}

export async function getConversationsByClient(clienteId: string) {
  try {
    const redisClient = getRedisClient()
    if (!redisClient) {
      console.log("[DB] ⚠️ Redis no disponible")
      return []
    }

    const pattern = `conversation_summary:*`
    const keys = await redisClient.keys(pattern)

    const conversations = []
    for (const key of keys) {
      const data = await redisClient.get(key)
      if (data) {
        const summary = safeJsonParse(data)
        if (summary && summary.clienteId === clienteId) {
          conversations.push(summary)
        }
      }
    }

    // Ordenar por último mensaje
    conversations.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())

    console.log(`[DB] 📋 Encontradas ${conversations.length} conversaciones para cliente ${clienteId}`)
    return conversations
  } catch (error) {
    console.error("[DB] ❌ Error obteniendo conversaciones:", error)
    return []
  }
}

export async function getConversationMessages(configId: string, phoneNumber: string) {
  try {
    const redisClient = getRedisClient()
    if (!redisClient) {
      console.log("[DB] ⚠️ Redis no disponible")
      return []
    }

    const pattern = `conversation_message:${configId}:${phoneNumber}:*`
    const keys = await redisClient.keys(pattern)

    const messages = []
    for (const key of keys) {
      const messageData = await redisClient.get(key)
      if (messageData) {
        const message = safeJsonParse(messageData)
        if (message) {
          messages.push(message)
        }
      }
    }

    // Ordenar por timestamp
    messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    console.log(`[DB] 💬 Encontrados ${messages.length} mensajes para ${phoneNumber}`)
    return messages
  } catch (error) {
    console.error("[DB] ❌ Error obteniendo mensajes:", error)
    return []
  }
}

export async function getAllClientsWithConversations() {
  try {
    // Obtener todas las configuraciones usando la función existente
    const configs = await getAllWhatsAppConfigs()

    // Agrupar por cliente_id
    const clientsMap = new Map()

    for (const config of configs) {
      if (!config.cliente_id) continue

      if (!clientsMap.has(config.cliente_id)) {
        clientsMap.set(config.cliente_id, {
          cliente_id: config.cliente_id,
          displayName: config.displayName,
          configs: [],
          totalConversations: 0,
          totalMessages: 0,
          activeConversations: 0,
        })
      }

      const client = clientsMap.get(config.cliente_id)
      client.configs.push(config)

      // Obtener conversaciones para esta configuración
      const conversations = await getConversationsByClient(config.cliente_id)
      client.totalConversations += conversations.length

      // Contar mensajes y conversaciones activas (últimas 24 horas)
      const now = new Date()
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)

      for (const conv of conversations) {
        client.totalMessages += conv.messageCount || 0
        if (new Date(conv.lastMessageAt) > yesterday) {
          client.activeConversations += 1
        }
      }
    }

    const clients = Array.from(clientsMap.values())
    console.log(`[DB] 👥 Encontrados ${clients.length} clientes con conversaciones`)
    return clients
  } catch (error) {
    console.error("[DB] ❌ Error obteniendo clientes:", error)
    return []
  }
}

// Helper functions
function getRedisClient() {
  // Implementation to get Redis client
  return null // Placeholder
}

function safeJsonParse(data: string | null): any {
  if (!data) return null
  try {
    return JSON.parse(data)
  } catch (error) {
    console.error("[DB] ❌ Error parsing JSON:", error)
    return null
  }
}
