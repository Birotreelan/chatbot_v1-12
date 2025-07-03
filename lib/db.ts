import { Redis } from "@upstash/redis"
import { v4 as generateId } from "uuid"

// Tipos
interface WhatsAppConfig {
  id: string
  phoneNumberId: string
  displayName: string
  assistantId: string
  active: boolean
  createdAt: string
  updatedAt: string
  verifyToken: string
  accessToken: string
  stats: {
    messagesReceived: number
    messagesProcessed: number
    errors: number
    lastMessageAt: string
  }
  apiBaseUrl?: string
  lastUserPhoneNumber?: string
  proxy?: string
  cliente_id?: string
  wabaId?: string
  widgetEnabled?: boolean
  widgetTitle?: string
  widgetPrimaryColor?: string
  widgetSecondaryColor?: string
  widgetPosition?: string
  widgetWelcomeMessage?: string
  widgetPlaceholder?: string
  widgetButtonText?: string
  widgetHeaderText?: string
  widgetSubtitle?: string
  widgetBrandingEnabled?: boolean
  widgetBrandingText?: string
  widgetMaxHeight?: number
  widgetMaxWidth?: number
  widgetBorderRadius?: number
  widgetShadow?: boolean
  widgetAnimation?: boolean
  widgetSoundEnabled?: boolean
  widgetTheme?: string
  widgetFloatingButtonText?: string
  widgetShowFloatingText?: boolean
  whatsappAssistantId?: string
  widgetAssistantId?: string
}

interface ThreadInfo {
  threadId: string
  phoneNumber: string
  whatsappConfigId: string
  lastMessageAt: string
  messageCount: number
  isNewThread?: boolean
  isResetThread?: boolean
}

// Utilidades para claves
const CONFIG_BY_ID = (id: string) => `whatsapp_config:${id}`
const CONFIG_BY_PHONE = (phone: string) => `whatsapp_config_phone:${phone}`

// Cliente Redis
function getRedisClient() {
  try {
    return Redis.fromEnv()
  } catch (error) {
    console.warn("Redis no disponible:", error)
    return null
  }
}

// Obtener configuración por Phone Number ID
export async function getWhatsAppConfigByPhoneId(phoneNumberId: string): Promise<WhatsAppConfig | null> {
  const redis = getRedisClient()
  if (!redis) return null

  try {
    const key = `whatsapp_config:${phoneNumberId}`
    const data = await redis.get(key)

    if (!data) {
      return null
    }

    if (typeof data === "string") {
      return JSON.parse(data)
    }

    return data as WhatsAppConfig
  } catch (error) {
    console.error("Error obteniendo configuración:", error)
    return null
  }
}

// Obtener configuración por ID
export async function getWhatsAppConfigById(id: string): Promise<WhatsAppConfig | null> {
  const redis = getRedisClient()
  if (!redis) return null

  try {
    // Buscar en todas las configuraciones
    const keys = await redis.keys("whatsapp_config:*")

    for (const key of keys) {
      const data = await redis.get(key)
      let config: WhatsAppConfig

      if (typeof data === "string") {
        config = JSON.parse(data)
      } else {
        config = data as WhatsAppConfig
      }

      if (config && config.id === id) {
        return config
      }
    }

    return null
  } catch (error) {
    console.error("Error obteniendo configuración por ID:", error)
    return null
  }
}

// Alias principal (algunos módulos importan getWhatsAppConfig directamente)
export async function getWhatsAppConfig(id: string) {
  return getWhatsAppConfigById(id)
}

// Alias para compatibilidad
export async function getConfigById(id: string): Promise<WhatsAppConfig | null> {
  return getWhatsAppConfigById(id)
}

// Obtener configuración por Cliente ID
export async function getWhatsappConfigByClienteId(clienteId: string): Promise<WhatsAppConfig | null> {
  const redis = getRedisClient()
  if (!redis) return null

  try {
    const keys = await redis.keys("whatsapp_config:*")

    for (const key of keys) {
      const data = await redis.get(key)
      let config: WhatsAppConfig

      if (typeof data === "string") {
        config = JSON.parse(data)
      } else {
        config = data as WhatsAppConfig
      }

      if (config && config.cliente_id === clienteId) {
        return config
      }
    }

    return null
  } catch (error) {
    console.error("Error obteniendo configuración por cliente ID:", error)
    return null
  }
}

// Alias para compatibilidad
export async function getConfigByClienteId(clienteId: string): Promise<WhatsAppConfig | null> {
  return getWhatsappConfigByClienteId(clienteId)
}

// Obtener todas las configuraciones
export async function getAllWhatsAppConfigs(): Promise<WhatsAppConfig[]> {
  const redis = getRedisClient()
  if (!redis) return []

  try {
    const keys = await redis.keys("whatsapp_config:*")
    const configs: WhatsAppConfig[] = []

    for (const key of keys) {
      const data = await redis.get(key)
      let config: WhatsAppConfig

      if (typeof data === "string") {
        config = JSON.parse(data)
      } else {
        config = data as WhatsAppConfig
      }

      if (config) {
        configs.push(config)
      }
    }

    return configs
  } catch (error) {
    console.error("Error obteniendo todas las configuraciones:", error)
    return []
  }
}

/**
 * Crea una nueva configuración de WhatsApp y la persiste en Redis.
 * También genera un mapeo phoneNumberId ➜ id para búsquedas rápidas.
 */
export async function createWhatsAppConfig(
  config: Omit<Partial<WhatsAppConfig>, "id" | "createdAt" | "updatedAt" | "stats"> & {
    phoneNumberId: string
    displayName: string
    assistantId: string
  },
): Promise<WhatsAppConfig> {
  const redis = getRedisClient()
  if (!redis) {
    throw new Error("Redis no disponible")
  }

  const id = generateId()
  const now = new Date().toISOString()

  const newConfig: WhatsAppConfig = {
    id,
    phoneNumberId: config.phoneNumberId,
    displayName: config.displayName,
    assistantId: config.assistantId,
    active: config.active ?? true,
    createdAt: now,
    updatedAt: now,
    verifyToken: config.verifyToken ?? generateId().slice(0, 16),
    accessToken: config.accessToken ?? "",
    stats: {
      messagesReceived: 0,
      messagesProcessed: 0,
      errors: 0,
      lastMessageAt: now,
    },
    ...config,
  }

  await redis.mset({
    [CONFIG_BY_ID(id)]: JSON.stringify(newConfig),
    [CONFIG_BY_PHONE(newConfig.phoneNumberId)]: id,
  })

  return newConfig
}

/**
 * Elimina una configuración existente (y su mapeo phoneNumberId ➜ id).
 */
export async function deleteWhatsAppConfig(id: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false

  const cfg = await getWhatsAppConfigById(id)
  if (!cfg) return false

  await redis.del(CONFIG_BY_ID(id))
  await redis.del(CONFIG_BY_PHONE(cfg.phoneNumberId))

  return true
}

// Actualizar estadísticas
export async function updateWhatsAppStats(configId: string, stats: Partial<WhatsAppConfig["stats"]>): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  try {
    // Buscar la configuración por ID
    const keys = await redis.keys("whatsapp_config:*")

    for (const key of keys) {
      const data = await redis.get(key)
      let config: WhatsAppConfig

      if (typeof data === "string") {
        config = JSON.parse(data)
      } else {
        config = data as WhatsAppConfig
      }

      if (config && config.id === configId) {
        // Actualizar estadísticas
        const updatedStats = {
          ...config.stats,
          ...stats,
          lastMessageAt: new Date().toISOString(),
        }

        // Incrementar contadores si se proporcionan
        if (stats.messagesReceived) {
          updatedStats.messagesReceived = (config.stats.messagesReceived || 0) + stats.messagesReceived
        }
        if (stats.messagesProcessed) {
          updatedStats.messagesProcessed = (config.stats.messagesProcessed || 0) + stats.messagesProcessed
        }
        if (stats.errors) {
          updatedStats.errors = (config.stats.errors || 0) + stats.errors
        }

        const updatedConfig = {
          ...config,
          stats: updatedStats,
          updatedAt: new Date().toISOString(),
        }

        await redis.set(key, JSON.stringify(updatedConfig))
        break
      }
    }
  } catch (error) {
    console.error("Error actualizando estadísticas:", error)
  }
}

// Actualizar configuración
export async function updateWhatsAppConfig(configId: string, updates: Partial<WhatsAppConfig>): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  try {
    const keys = await redis.keys("whatsapp_config:*")

    for (const key of keys) {
      const data = await redis.get(key)
      let config: WhatsAppConfig

      if (typeof data === "string") {
        config = JSON.parse(data)
      } else {
        config = data as WhatsAppConfig
      }

      if (config && config.id === configId) {
        const updatedConfig = {
          ...config,
          ...updates,
          updatedAt: new Date().toISOString(),
        }

        await redis.set(key, JSON.stringify(updatedConfig))
        break
      }
    }
  } catch (error) {
    console.error("Error actualizando configuración:", error)
  }
}

// Obtener thread para usuario
export async function getThreadForUser(
  phoneNumber: string,
  configId: string,
): Promise<ThreadInfo & { isNewThread: boolean; isResetThread: boolean }> {
  const redis = getRedisClient()

  const key = `thread:${phoneNumber}:${configId}`

  try {
    if (redis) {
      const data = await redis.get(key)

      if (data) {
        let threadInfo: ThreadInfo
        if (typeof data === "string") {
          threadInfo = JSON.parse(data)
        } else {
          threadInfo = data as ThreadInfo
        }

        // Actualizar último mensaje
        const updatedInfo = {
          ...threadInfo,
          lastMessageAt: new Date().toISOString(),
          messageCount: (threadInfo.messageCount || 0) + 1,
        }

        await redis.set(key, JSON.stringify(updatedInfo))

        return {
          ...updatedInfo,
          isNewThread: false,
          isResetThread: threadInfo.isResetThread || false,
        }
      }
    }

    // Crear nuevo thread
    const openai = new (await import("openai")).default({
      apiKey: process.env.OPENAI_API_KEY,
    })

    const thread = await openai.beta.threads.create()

    const threadInfo: ThreadInfo = {
      threadId: thread.id,
      phoneNumber,
      whatsappConfigId: configId,
      lastMessageAt: new Date().toISOString(),
      messageCount: 1,
    }

    if (redis) {
      await redis.set(key, JSON.stringify(threadInfo))
    }

    return {
      ...threadInfo,
      isNewThread: true,
      isResetThread: false,
    }
  } catch (error) {
    console.error("Error obteniendo thread:", error)
    throw error
  }
}

// Reset thread para usuario
export async function resetThreadForUser(phoneNumber: string, configId: string): Promise<{ threadId: string }> {
  const redis = getRedisClient()

  try {
    const openai = new (await import("openai")).default({
      apiKey: process.env.OPENAI_API_KEY,
    })

    const thread = await openai.beta.threads.create()

    const key = `thread:${phoneNumber}:${configId}`
    const threadInfo: ThreadInfo = {
      threadId: thread.id,
      phoneNumber,
      whatsappConfigId: configId,
      lastMessageAt: new Date().toISOString(),
      messageCount: 1,
      isResetThread: true,
    }

    if (redis) {
      await redis.set(key, JSON.stringify(threadInfo))
    }

    return { threadId: thread.id }
  } catch (error) {
    console.error("Error reseteando thread:", error)
    throw error
  }
}

// Obtener estadísticas del sistema
export async function getSystemStats(): Promise<{
  totalConfigs: number
  activeConfigs: number
  totalMessages: number
  totalErrors: number
}> {
  const redis = getRedisClient()
  if (!redis) {
    return {
      totalConfigs: 0,
      activeConfigs: 0,
      totalMessages: 0,
      totalErrors: 0,
    }
  }

  try {
    const configs = await getAllWhatsAppConfigs()

    const stats = configs.reduce(
      (acc, config) => {
        return {
          totalConfigs: acc.totalConfigs + 1,
          activeConfigs: acc.activeConfigs + (config.active ? 1 : 0),
          totalMessages: acc.totalMessages + (config.stats.messagesReceived || 0),
          totalErrors: acc.totalErrors + (config.stats.errors || 0),
        }
      },
      {
        totalConfigs: 0,
        activeConfigs: 0,
        totalMessages: 0,
        totalErrors: 0,
      },
    )

    return stats
  } catch (error) {
    console.error("Error obteniendo estadísticas del sistema:", error)
    return {
      totalConfigs: 0,
      activeConfigs: 0,
      totalMessages: 0,
      totalErrors: 0,
    }
  }
}
