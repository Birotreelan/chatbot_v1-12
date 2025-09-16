import { Redis } from "@upstash/redis"
import type { WhatsAppConfig, ThreadInfo, SystemStats, ConversationMessage, ClientConversation } from "./types"
import OpenAI from "openai"

const redis = Redis.fromEnv()

// Función auxiliar para manejar la serialización/deserialización segura
function safeJsonParse(data: any): any {
  if (typeof data === "string") {
    try {
      return JSON.parse(data)
    } catch (error) {
      console.error("[DB] Error al parsear JSON:", error)
      return null
    }
  }
  return data // Si ya es un objeto, devolverlo tal cual
}

// Configuraciones de WhatsApp
export async function saveWhatsAppConfig(config: Omit<WhatsAppConfig, "createdAt" | "updatedAt">): Promise<void> {
  const now = new Date()
  const configWithDates = {
    ...config,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }

  await redis.hset(`whatsapp:config:${config.id}`, configWithDates)
  await redis.sadd("whatsapp:configs", config.id)
}

export async function getWhatsAppConfig(phoneNumberId: string): Promise<WhatsAppConfig | null> {
  try {
    const configIds = await redis.smembers("whatsapp:configs")

    for (const configId of configIds) {
      const config = await redis.hgetall(`whatsapp:config:${configId}`)
      if (config && config.phoneNumberId === phoneNumberId && config.isActive === "true") {
        return {
          ...config,
          isActive: config.isActive === "true",
          createdAt: new Date(config.createdAt),
          updatedAt: new Date(config.updatedAt),
        } as WhatsAppConfig
      }
    }

    return null
  } catch (error) {
    console.error("Error obteniendo configuración de WhatsApp:", error)
    return null
  }
}

export async function getAllWhatsAppConfigs(): Promise<WhatsAppConfig[]> {
  try {
    const configIds = await redis.smembers("whatsapp:configs")
    const configs: WhatsAppConfig[] = []

    for (const configId of configIds) {
      const config = await redis.hgetall(`whatsapp:config:${configId}`)
      if (config) {
        configs.push({
          ...config,
          isActive: config.isActive === "true",
          createdAt: new Date(config.createdAt),
          updatedAt: new Date(config.updatedAt),
        } as WhatsAppConfig)
      }
    }

    return configs
  } catch (error) {
    console.error("Error obteniendo configuraciones:", error)
    return []
  }
}

export async function updateWhatsAppConfig(id: string, updates: Partial<WhatsAppConfig>): Promise<void> {
  const updatesWithDate = {
    ...updates,
    updatedAt: new Date().toISOString(),
  }

  await redis.hset(`whatsapp:config:${id}`, updatesWithDate)
}

export async function deleteWhatsAppConfig(id: string): Promise<void> {
  await redis.del(`whatsapp:config:${id}`)
  await redis.srem("whatsapp:configs", id)
}

// Funciones para la gestión de threads

// Obtener o crear un thread para un usuario y configuración
export async function getThreadForUser(
  phoneNumber: string,
  whatsappConfigId: string,
): Promise<{ threadId: string; isNewThread: boolean; isResetThread?: boolean }> {
  const key = `${phoneNumber}:${whatsappConfigId}`
  const redisClient = redis

  console.log(`[DB] 🔍 Obteniendo thread para ${phoneNumber} con config ${whatsappConfigId}`)

  if (redisClient) {
    // Intentar obtener el thread existente
    const threadData = await redisClient.get(key)
    const threadInfo = safeJsonParse(threadData)

    if (threadInfo) {
      console.log(`[DB] ✅ Thread encontrado: ${threadInfo.threadId}`)

      // Verificar si es un thread reseteado
      const isResetThread = threadInfo.isResetThread === true

      // Actualizar la información del thread
      const updatedThreadInfo = {
        ...threadInfo,
        lastMessageAt: new Date().toISOString(),
        messageCount: (threadInfo.messageCount || 0) + 1,
        // Limpiar el flag de reset después del primer uso
        isResetThread: false,
      }

      // Guardar en Redis - siempre como cadena JSON
      await redisClient.set(key, JSON.stringify(updatedThreadInfo))

      return {
        threadId: threadInfo.threadId,
        isNewThread: false,
        isResetThread,
      }
    }
  }

  // Crear un nuevo thread
  console.log(`[DB] 📝 No se encontró thread existente, creando uno nuevo`)
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })

  const thread = await openai.beta.threads.create()
  console.log(`[DB] ✅ Nuevo thread creado: ${thread.id}`)

  // Guardar la información del thread
  const newThreadInfo: ThreadInfo = {
    threadId: thread.id,
    phoneNumber,
    whatsappConfigId,
    lastMessageAt: new Date().toISOString(),
    messageCount: 1,
  }

  if (redisClient) {
    // Guardar en Redis - siempre como cadena JSON
    await redisClient.set(key, JSON.stringify(newThreadInfo))
  }

  // Actualizar estadísticas
  await updateSystemStats()

  return { threadId: thread.id, isNewThread: true }
}

// Resetear un thread para un usuario - OPTIMIZADO
export async function resetThreadForUser(
  phoneNumber: string,
  whatsappConfigId: string,
): Promise<{ threadId: string; isNewThread: boolean }> {
  const key = `${phoneNumber}:${whatsappConfigId}`
  const redisClient = redis

  console.log(`[DB] 🔄 RESETEANDO thread para ${phoneNumber} con config ${whatsappConfigId}`)

  try {
    // 1. CREAR UN THREAD COMPLETAMENTE NUEVO EN OPENAI
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })

    const newThread = await openai.beta.threads.create()
    console.log(`[DB] ✅ NUEVO thread creado en OpenAI: ${newThread.id}`)

    // 2. ELIMINAR COMPLETAMENTE EL THREAD ANTERIOR
    if (redisClient) {
      await redisClient.del(key)
      console.log(`[DB] ✅ Thread anterior eliminado de Redis`)
    }

    // 3. GUARDAR EL NUEVO THREAD CON FLAG DE RESET
    const newThreadInfo: ThreadInfo = {
      threadId: newThread.id,
      phoneNumber,
      whatsappConfigId,
      lastMessageAt: new Date().toISOString(),
      messageCount: 0, // Empezar en 0 para que se considere nuevo
      isResetThread: true, // Flag para indicar que es un thread reseteado
      createdAt: new Date().toISOString(),
    }

    if (redisClient) {
      await redisClient.set(key, JSON.stringify(newThreadInfo))
      console.log(`[DB] ✅ Nuevo thread guardado en Redis: ${newThread.id}`)
    }

    // 4. ACTUALIZAR ESTADÍSTICAS
    await updateSystemStats()

    console.log(`[DB] ✅ RESET COMPLETADO: ${newThread.id}`)
    return { threadId: newThread.id, isNewThread: true }
  } catch (error) {
    console.error(`[DB] ❌ Error al resetear thread:`, error)
    throw error
  }
}

// Obtener todos los threads
export async function getAllThreads(): Promise<ThreadInfo[]> {
  const redisClient = redis

  if (redisClient) {
    const keys = await redisClient.keys("*")
    const threads: ThreadInfo[] = []

    for (const key of keys) {
      const threadData = await redisClient.get(key)
      const threadInfo = safeJsonParse(threadData)

      if (threadInfo) {
        threads.push(threadInfo)
      }
    }

    return threads
  }

  return []
}

// Funciones para estadísticas del sistema

// Actualizar estadísticas del sistema
export async function updateSystemStats(): Promise<SystemStats> {
  const configs = await getAllWhatsAppConfigs()
  const threads = await getAllThreads()

  const stats: SystemStats = {
    totalConfigs: configs.length,
    activeConfigs: configs.filter((c) => c.isActive).length,
    totalMessages: threads.reduce((sum, t) => sum + (t.messageCount || 0), 0),
    totalThreads: threads.length,
    lastUpdated: new Date().toISOString(),
  }

  const redisClient = redis

  if (redisClient) {
    // Guardar en Redis - siempre como cadena JSON
    await redisClient.set("system:stats", JSON.stringify(stats))
  }

  return stats
}

// Obtener estadísticas del sistema
export async function getSystemStats(): Promise<SystemStats> {
  const redisClient = redis

  if (redisClient) {
    const statsData = await redisClient.get("system:stats")
    // Usar la función auxiliar para manejar la deserialización
    const stats = safeJsonParse(statsData)

    if (!stats) {
      return updateSystemStats()
    }

    return stats
  }

  return updateSystemStats()
}

// Actualizar estadísticas de un número de WhatsApp
export async function updateWhatsAppStats(
  configId: string,
  updates: { messagesReceived?: number; messagesProcessed?: number; errors?: number },
): Promise<void> {
  const config = await getWhatsAppConfig(configId)
  if (!config) return

  const updatedStats = {
    ...config.stats,
    messagesReceived: (config.stats?.messagesReceived || 0) + (updates.messagesReceived || 0),
    messagesProcessed: (config.stats?.messagesProcessed || 0) + (updates.messagesProcessed || 0),
    errors: (config.stats?.errors || 0) + (updates.errors || 0),
    lastMessageAt: updates.messagesReceived ? new Date().toISOString() : config.stats?.lastMessageAt,
  }

  await updateWhatsAppConfig(configId, { stats: updatedStats })
}

// Función adicional para obtener configuración por ID (alias para compatibilidad)
export async function getWhatsAppConfigById(id: string): Promise<WhatsAppConfig | null> {
  return getWhatsAppConfig(id)
}

// Funciones para manejo de mensajes de conversaciones
export async function saveConversationMessage(message: ConversationMessage): Promise<string | null> {
  try {
    const redisClient = redis
    if (!redisClient) {
      console.log("[DB] ⚠️ Redis no disponible, no se puede guardar el mensaje")
      return null
    }

    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const messageData = {
      ...message,
      messageId,
      timestamp: message.timestamp.toISOString(),
    }

    // Guardar mensaje individual con TTL de 7 días (604800 segundos)
    const messageKey = `conversation:${message.clientId}:${messageId}`
    await redisClient.setex(messageKey, 7 * 24 * 60 * 60, JSON.stringify(messageData))

    // Actualizar resumen de conversación
    const summaryKey = `client:${message.clientId}`
    const existingSummaryData = await redisClient.hgetall(summaryKey)
    const existingSummary = safeJsonParse(existingSummaryData)

    const summary = existingSummary || {
      clientId: message.clientId,
      clientName: message.clientName,
      phoneNumberId: message.phoneNumberId,
      lastMessage: message.message.substring(0, 100) + (message.message.length > 100 ? "..." : ""),
      lastMessageTime: message.timestamp,
      messageCount: 0,
    }

    summary.messageCount += 1
    summary.lastMessage = message.message.substring(0, 100) + (message.message.length > 100 ? "..." : "")
    summary.lastMessageTime = message.timestamp

    await redisClient.hset(summaryKey, summary)

    console.log(`[DB] 💬 Mensaje guardado: ${message.messageId}`)
    return messageId
  } catch (error) {
    console.error("[DB] ❌ Error guardando mensaje:", error)
    return null
  }
}

export async function getClientMessages(clientId: string, limit = 50): Promise<ConversationMessage[]> {
  try {
    // Obtener IDs de mensajes ordenados por timestamp (más recientes primero)
    const messageIds = await redis.zrevrange(`messages:${clientId}`, 0, limit - 1)

    const messages: ConversationMessage[] = []

    for (const messageId of messageIds) {
      const messageData = await redis.get(`conversation:${clientId}:${messageId}`)
      if (messageData) {
        const message = JSON.parse(messageData as string)
        messages.push({
          ...message,
          timestamp: new Date(message.timestamp),
        })
      }
    }

    return messages
  } catch (error) {
    console.error(`[DB] ❌ Error obteniendo mensajes para ${clientId}:`, error)
    return []
  }
}

export async function getAllClientsWithConversations(): Promise<ClientConversation[]> {
  try {
    const clientIds = await redis.smembers("clients")
    const clients: ClientConversation[] = []

    for (const clientId of clientIds) {
      const clientData = await redis.hgetall(`client:${clientId}`)
      if (clientData) {
        // Contar mensajes
        const messageCount = await redis.zcard(`messages:${clientId}`)

        clients.push({
          clientId: clientData.clientId,
          clientName: clientData.clientName,
          phoneNumberId: clientData.phoneNumberId,
          lastMessage: clientData.lastMessage,
          lastMessageTime: new Date(clientData.lastMessageTime),
          messageCount: messageCount || 0,
          threadId: clientData.threadId || undefined,
        })
      }
    }

    // Ordenar por último mensaje (más reciente primero)
    return clients.sort((a, b) => b.lastMessageTime.getTime() - a.lastMessageTime.getTime())
  } catch (error) {
    console.error("[DB] ❌ Error obteniendo clientes:", error)
    return []
  }
}

// Función para limpiar mensajes antiguos (llamada por cron)
export async function cleanupOldMessages(): Promise<void> {
  try {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const clientIds = await redis.smembers("clients")

    for (const clientId of clientIds) {
      // Obtener mensajes antiguos
      const oldMessageIds = await redis.zrangebyscore(`messages:${clientId}`, 0, sevenDaysAgo)

      // Eliminar mensajes antiguos
      for (const messageId of oldMessageIds) {
        await redis.del(`conversation:${clientId}:${messageId}`)
      }

      // Limpiar de la lista ordenada
      await redis.zremrangebyscore(`messages:${clientId}`, 0, sevenDaysAgo)
    }

    console.log("[DB] ✅ Limpieza de mensajes antiguos completada")
  } catch (error) {
    console.error("[DB] ❌ Error en limpieza:", error)
  }
}
