import { Redis } from "@upstash/redis"
import type { WhatsAppConfig, ThreadInfo, SystemStats } from "./types"
import { nanoid } from "nanoid"

// Inicializar el cliente de Redis
let redis: Redis | null = null

// Función para obtener el cliente de Redis
function getRedisClient() {
  if (redis) return redis

  try {
    redis = Redis.fromEnv()
    console.log(`[DB] ✅ Redis conectado`)
    return redis
  } catch (error) {
    console.warn(`[DB] ⚠️ Redis no disponible:`, error)
    return null
  }
}

// Almacenamiento en memoria como fallback
const memoryStorage = {
  configs: new Map<string, WhatsAppConfig>(),
  phoneToConfig: new Map<string, string>(),
  threads: new Map<string, ThreadInfo>(),
  stats: null as SystemStats | null,
}

// Prefijos para las claves en Redis
const CONFIG_PREFIX = "whatsapp_config:"
const THREAD_PREFIX = "thread:"
const PHONE_TO_CONFIG_PREFIX = "phone_to_config:"
const STATS_KEY = "system_stats"

// Función auxiliar para manejar la serialización/deserialización segura
function safeJsonParse(data: any): any {
  if (typeof data === "string") {
    try {
      return JSON.parse(data)
    } catch (error) {
      console.error(`[DB] ❌ Error parsear JSON:`, error)
      return null
    }
  }
  return data
}

// Crear una nueva configuración
export async function createWhatsAppConfig(config: Partial<WhatsAppConfig>): Promise<WhatsAppConfig> {
  const id = config.id || nanoid()
  const now = new Date().toISOString()

  console.log(`[DB] 📝 Creando config: ${id.slice(0, 8)}`)

  const newConfig: WhatsAppConfig = {
    id,
    phoneNumberId: config.phoneNumberId || "",
    wabaId: config.wabaId || "",
    displayName: config.displayName || `WhatsApp ${id.slice(0, 6)}`,
    whatsappAssistantId: config.whatsappAssistantId || process.env.OPENAI_ASSISTANT_ID || "",
    widgetAssistantId: config.widgetAssistantId || process.env.OPENAI_ASSISTANT_ID || "",
    active: config.active !== undefined ? config.active : true,
    createdAt: now,
    updatedAt: now,
    verifyToken: config.verifyToken || nanoid(16),
    accessToken: config.accessToken || "",
    webhookUrl: config.webhookUrl,
    cliente_id: config.cliente_id,
    proxy: config.proxy,
    widgetEnabled: config.widgetEnabled !== undefined ? config.widgetEnabled : true,
    widgetTitle: config.widgetTitle || "Asistente Virtual",
    widgetPrimaryColor: config.widgetPrimaryColor || "#0ea5e9",
    widgetSecondaryColor: config.widgetSecondaryColor || "#f0f9ff",
    widgetPosition: config.widgetPosition || "bottom-right",
    widgetWelcomeMessage: config.widgetWelcomeMessage || "¡Hola! ¿En qué puedo ayudarte hoy?",
    widgetPlaceholder: config.widgetPlaceholder || "Escribe tu mensaje...",
    widgetButtonText: config.widgetButtonText || "Enviar",
    widgetHeaderText: config.widgetHeaderText || "Chat de Soporte",
    widgetSubtitle: config.widgetSubtitle || "Estamos aquí para ayudarte",
    widgetBrandingEnabled: config.widgetBrandingEnabled !== undefined ? config.widgetBrandingEnabled : true,
    widgetBrandingText: config.widgetBrandingText || "Powered by AI",
    widgetMaxHeight: config.widgetMaxHeight || 600,
    widgetMaxWidth: config.widgetMaxWidth || 400,
    widgetBorderRadius: config.widgetBorderRadius || 12,
    widgetShadow: config.widgetShadow !== undefined ? config.widgetShadow : true,
    widgetAnimation: config.widgetAnimation !== undefined ? config.widgetAnimation : true,
    widgetSoundEnabled: config.widgetSoundEnabled !== undefined ? config.widgetSoundEnabled : true,
    widgetTheme: config.widgetTheme || "light",
    widgetFloatingButtonText: config.widgetFloatingButtonText || "Obtené tu turno con nuestro asistente virtual",
    widgetShowFloatingText: config.widgetShowFloatingText !== undefined ? config.widgetShowFloatingText : true,
    stats: {
      messagesReceived: 0,
      messagesProcessed: 0,
      errors: 0,
    },
  }

  const redisClient = getRedisClient()

  if (redisClient) {
    console.log(`[DB] 💾 Guardando en Redis: ${id.slice(0, 8)}`)
    await redisClient.set(`${CONFIG_PREFIX}${id}`, JSON.stringify(newConfig))

    if (newConfig.phoneNumberId) {
      await redisClient.set(`${PHONE_TO_CONFIG_PREFIX}${newConfig.phoneNumberId}`, id)
    }
  } else {
    console.log(`[DB] 💾 Guardando en memoria: ${id.slice(0, 8)}`)
    memoryStorage.configs.set(id, newConfig)
    if (newConfig.phoneNumberId) {
      memoryStorage.phoneToConfig.set(newConfig.phoneNumberId, id)
    }
  }

  await updateSystemStats()
  console.log(`[DB] ✅ Config creada: ${id.slice(0, 8)}`)
  return newConfig
}

// Obtener una configuración por ID
export async function getWhatsAppConfig(id: string): Promise<WhatsAppConfig | null> {
  try {
    const redisClient = getRedisClient()

    if (redisClient) {
      const configData = await redisClient.get(`${CONFIG_PREFIX}${id}`)

      if (!configData) {
        console.log(`[DB] ❌ Config no encontrada: ${id.slice(0, 8)}`)
        return null
      }

      const config = safeJsonParse(configData)
      if (!config) {
        console.error(`[DB] ❌ Error deserializar: ${id.slice(0, 8)}`)
        return null
      }

      return config
    } else {
      const config = memoryStorage.configs.get(id) || null
      return config
    }
  } catch (error) {
    console.error(`[DB] ❌ Error obtener config ${id.slice(0, 8)}:`, error)
    return null
  }
}

// Obtener una configuración por ID de número de teléfono
export async function getWhatsAppConfigByPhoneId(phoneNumberId: string): Promise<WhatsAppConfig | null> {
  const redisClient = getRedisClient()

  if (redisClient) {
    const key = `${PHONE_TO_CONFIG_PREFIX}${phoneNumberId}`
    const configId = await redisClient.get(key)

    if (!configId) {
      const allConfigs = await getAllWhatsAppConfigs()
      const manualMatch = allConfigs.find((c) => c.phoneNumberId === phoneNumberId)

      if (manualMatch) {
        await redisClient.set(key, manualMatch.id)
        return manualMatch
      }

      return null
    }

    const config = await getWhatsAppConfig(configId as string)
    return config
  } else {
    const configId = memoryStorage.phoneToConfig.get(phoneNumberId)

    if (!configId) {
      const allConfigs = Array.from(memoryStorage.configs.values())
      const manualMatch = allConfigs.find((c) => c.phoneNumberId === phoneNumberId)

      if (manualMatch) {
        memoryStorage.phoneToConfig.set(phoneNumberId, manualMatch.id)
        return manualMatch
      }

      return null
    }

    return memoryStorage.configs.get(configId) || null
  }
}

// Obtener todas las configuraciones
export async function getAllWhatsAppConfigs(): Promise<WhatsAppConfig[]> {
  try {
    const redisClient = getRedisClient()

    if (redisClient) {
      const keys = await redisClient.keys(`${CONFIG_PREFIX}*`)

      if (keys.length === 0) {
        return []
      }

      const configs = await Promise.all(
        keys.map(async (key) => {
          const configData = await redisClient.get(key)
          const config = safeJsonParse(configData)
          return config
        }),
      )

      const validConfigs = configs.filter(Boolean) as WhatsAppConfig[]
      return validConfigs
    } else {
      const configs = Array.from(memoryStorage.configs.values())
      return configs
    }
  } catch (error) {
    console.error(`[DB] ❌ Error obtener todas las configs:`, error)
    return []
  }
}

// Actualizar una configuración
export async function updateWhatsAppConfig(
  id: string,
  updates: Partial<WhatsAppConfig>,
): Promise<WhatsAppConfig | null> {
  try {
    const config = await getWhatsAppConfig(id)
    if (!config) {
      console.log(`[DB] ❌ Config no encontrada para actualizar: ${id.slice(0, 8)}`)
      return null
    }

    const redisClient = getRedisClient()

    if (redisClient) {
      if (updates.phoneNumberId && updates.phoneNumberId !== config.phoneNumberId) {
        if (config.phoneNumberId) {
          await redisClient.del(`${PHONE_TO_CONFIG_PREFIX}${config.phoneNumberId}`)
        }
        await redisClient.set(`${PHONE_TO_CONFIG_PREFIX}${updates.phoneNumberId}`, id)
      }

      const updatedConfig: WhatsAppConfig = {
        ...config,
        ...updates,
        updatedAt: new Date().toISOString(),
      }

      const serializedConfig = JSON.stringify(updatedConfig)
      await redisClient.set(`${CONFIG_PREFIX}${id}`, serializedConfig)

      return updatedConfig
    } else {
      if (updates.phoneNumberId && updates.phoneNumberId !== config.phoneNumberId) {
        if (config.phoneNumberId) {
          memoryStorage.phoneToConfig.delete(config.phoneNumberId)
        }
        memoryStorage.phoneToConfig.set(updates.phoneNumberId, id)
      }

      const updatedConfig: WhatsAppConfig = {
        ...config,
        ...updates,
        updatedAt: new Date().toISOString(),
      }

      memoryStorage.configs.set(id, updatedConfig)
      return updatedConfig
    }
  } catch (error) {
    console.error(`[DB] ❌ Error actualizar config ${id.slice(0, 8)}:`, error)
    throw error
  }
}

// Eliminar una configuración
export async function deleteWhatsAppConfig(id: string): Promise<boolean> {
  const config = await getWhatsAppConfig(id)
  if (!config) return false

  const redisClient = getRedisClient()

  if (redisClient) {
    if (config.phoneNumberId) {
      await redisClient.del(`${PHONE_TO_CONFIG_PREFIX}${config.phoneNumberId}`)
    }
    await redisClient.del(`${CONFIG_PREFIX}${id}`)
  } else {
    if (config.phoneNumberId) {
      memoryStorage.phoneToConfig.delete(config.phoneNumberId)
    }
    memoryStorage.configs.delete(id)
  }

  await updateSystemStats()
  return true
}

// Función para obtener configuración por clienteId
export async function getConfigByClienteId(clienteId: string): Promise<WhatsAppConfig | null> {
  try {
    const configs = await getAllWhatsAppConfigs()
    const config = configs.find((config) => config.cliente_id === clienteId)

    if (config) {
      console.log(`[DB] ✅ Config encontrada por cliente_id: ${config.displayName}`)
      return config
    }

    console.log(`[DB] ❌ No se encontró config para cliente_id: ${clienteId}`)
    return null
  } catch (error) {
    console.error(`[DB] ❌ Error buscar por cliente_id:`, error)
    return null
  }
}

// Obtener o crear un thread para un usuario y configuración
export async function getThreadForUser(
  phoneNumber: string,
  whatsappConfigId: string,
): Promise<{ threadId: string; isNewThread: boolean; isResetThread?: boolean }> {
  const key = `${THREAD_PREFIX}${phoneNumber}:${whatsappConfigId}`
  const redisClient = getRedisClient()

  if (redisClient) {
    const threadData = await redisClient.get(key)
    const threadInfo = safeJsonParse(threadData)

    if (threadInfo) {
      const isResetThread = threadInfo.isResetThread === true

      const updatedThreadInfo = {
        ...threadInfo,
        lastMessageAt: new Date().toISOString(),
        messageCount: (threadInfo.messageCount || 0) + 1,
        isResetThread: false,
      }

      await redisClient.set(key, JSON.stringify(updatedThreadInfo))

      return {
        threadId: threadInfo.threadId,
        isNewThread: false,
        isResetThread,
      }
    }
  } else {
    const threadInfo = memoryStorage.threads.get(key)

    if (threadInfo) {
      const isResetThread = threadInfo.isResetThread === true

      const updatedThreadInfo = {
        ...threadInfo,
        lastMessageAt: new Date().toISOString(),
        messageCount: (threadInfo.messageCount || 0) + 1,
        isResetThread: false,
      }

      memoryStorage.threads.set(key, updatedThreadInfo)

      return {
        threadId: threadInfo.threadId,
        isNewThread: false,
        isResetThread,
      }
    }
  }

  // Crear un nuevo thread
  console.log(`[DB] 📝 Creando nuevo thread`)
  const openai = new (await import("openai")).default({
    apiKey: process.env.OPENAI_API_KEY,
  })

  const thread = await openai.beta.threads.create()
  console.log(`[DB] ✅ Thread creado: ${thread.id.slice(-8)}`)

  const newThreadInfo: ThreadInfo = {
    threadId: thread.id,
    phoneNumber,
    whatsappConfigId,
    lastMessageAt: new Date().toISOString(),
    messageCount: 1,
  }

  if (redisClient) {
    await redisClient.set(key, JSON.stringify(newThreadInfo))
  } else {
    memoryStorage.threads.set(key, newThreadInfo)
  }

  await updateSystemStats()

  return { threadId: thread.id, isNewThread: true }
}

// Resetear un thread para un usuario
export async function resetThreadForUser(
  phoneNumber: string,
  whatsappConfigId: string,
): Promise<{ threadId: string; isNewThread: boolean }> {
  const key = `${THREAD_PREFIX}${phoneNumber}:${whatsappConfigId}`
  const redisClient = getRedisClient()

  console.log(`[DB] 🔄 Reseteando thread: ${phoneNumber}`)

  try {
    const openai = new (await import("openai")).default({
      apiKey: process.env.OPENAI_API_KEY,
    })

    const newThread = await openai.beta.threads.create()
    console.log(`[DB] ✅ Nuevo thread: ${newThread.id.slice(-8)}`)

    if (redisClient) {
      await redisClient.del(key)
      console.log(`[DB] ✅ Thread anterior eliminado`)
    } else {
      memoryStorage.threads.delete(key)
      console.log(`[DB] ✅ Thread anterior eliminado`)
    }

    const newThreadInfo: ThreadInfo = {
      threadId: newThread.id,
      phoneNumber,
      whatsappConfigId,
      lastMessageAt: new Date().toISOString(),
      messageCount: 0,
      isResetThread: true,
      createdAt: new Date().toISOString(),
    }

    if (redisClient) {
      await redisClient.set(key, JSON.stringify(newThreadInfo))
      console.log(`[DB] ✅ Nuevo thread guardado`)
    } else {
      memoryStorage.threads.set(key, newThreadInfo)
      console.log(`[DB] ✅ Nuevo thread guardado`)
    }

    await updateSystemStats()

    console.log(`[DB] ✅ Reset completado: ${newThread.id.slice(-8)}`)
    return { threadId: newThread.id, isNewThread: true }
  } catch (error) {
    console.error(`[DB] ❌ Error resetear thread:`, error)
    throw error
  }
}

// Obtener todos los threads
export async function getAllThreads(): Promise<ThreadInfo[]> {
  const redisClient = getRedisClient()

  if (redisClient) {
    const keys = await redisClient.keys(`${THREAD_PREFIX}*`)

    if (keys.length === 0) return []

    const threads = await Promise.all(
      keys.map(async (key) => {
        const threadData = await redisClient.get(key)
        return safeJsonParse(threadData)
      }),
    )

    return threads.filter(Boolean) as ThreadInfo[]
  } else {
    return Array.from(memoryStorage.threads.values())
  }
}

// Actualizar estadísticas del sistema
export async function updateSystemStats(): Promise<SystemStats> {
  const configs = await getAllWhatsAppConfigs()
  const threads = await getAllThreads()

  const stats: SystemStats = {
    totalConfigs: configs.length,
    activeConfigs: configs.filter((c) => c.active).length,
    totalMessages: threads.reduce((sum, t) => sum + (t.messageCount || 0), 0),
    totalThreads: threads.length,
    lastUpdated: new Date().toISOString(),
  }

  const redisClient = getRedisClient()

  if (redisClient) {
    await redisClient.set(STATS_KEY, JSON.stringify(stats))
  } else {
    memoryStorage.stats = stats
  }

  return stats
}

// Obtener estadísticas del sistema
export async function getSystemStats(): Promise<SystemStats> {
  const redisClient = getRedisClient()

  if (redisClient) {
    const statsData = await redisClient.get(STATS_KEY)
    const stats = safeJsonParse(statsData)

    if (!stats) {
      return updateSystemStats()
    }

    return stats
  } else {
    if (!memoryStorage.stats) {
      return updateSystemStats()
    }

    return memoryStorage.stats
  }
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

// Export alias for compatibility
export const getWhatsappConfigByClienteId = getConfigByClienteId
export const getConfigById = getWhatsAppConfig
export async function getWhatsAppConfigById(id: string): Promise<WhatsAppConfig | null> {
  return getWhatsAppConfig(id)
}
