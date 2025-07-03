import { Redis } from "@upstash/redis"

// Configuración de Redis
const redis = Redis.fromEnv()

// Tipos
export interface WhatsAppConfig {
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

export interface ThreadInfo {
  threadId: string
  phoneNumber: string
  whatsappConfigId: string
  lastMessageAt: string
  messageCount: number
  isResetThread?: boolean
}

// Función para obtener configuración de WhatsApp por ID
export async function getWhatsAppConfig(id: string): Promise<WhatsAppConfig | null> {
  try {
    const key = `whatsapp_config:${id}`
    const data = await redis.get(key)

    if (!data) {
      return null
    }

    // Si es string, parsearlo como JSON
    if (typeof data === "string") {
      return JSON.parse(data)
    }

    // Si ya es objeto, devolverlo directamente
    return data as WhatsAppConfig
  } catch (error) {
    console.error("[DB] Error obteniendo configuración:", error)
    return null
  }
}

// Función para obtener configuración de WhatsApp por phoneNumberId
export async function getWhatsAppConfigByPhoneId(phoneNumberId: string): Promise<WhatsAppConfig | null> {
  try {
    // Buscar por phoneNumberId usando un patrón
    const keys = await redis.keys("whatsapp_config:*")

    for (const key of keys) {
      const data = await redis.get(key)
      if (data) {
        let config: WhatsAppConfig

        if (typeof data === "string") {
          config = JSON.parse(data)
        } else {
          config = data as WhatsAppConfig
        }

        if (config.phoneNumberId === phoneNumberId) {
          return config
        }
      }
    }

    return null
  } catch (error) {
    console.error("[DB] Error buscando configuración por phoneNumberId:", error)
    return null
  }
}

// Función para crear configuración de WhatsApp
export async function createWhatsAppConfig(config: Omit<WhatsAppConfig, "id" | "createdAt" | "updatedAt">) {
  try {
    const id = generateId()
    const now = new Date().toISOString()

    const newConfig: WhatsAppConfig = {
      ...config,
      id,
      createdAt: now,
      updatedAt: now,
    }

    const key = `whatsapp_config:${id}`
    await redis.set(key, JSON.stringify(newConfig))

    return newConfig
  } catch (error) {
    console.error("[DB] Error creando configuración:", error)
    throw error
  }
}

// Función para actualizar configuración de WhatsApp
export async function updateWhatsAppConfig(id: string, updates: Partial<WhatsAppConfig>) {
  try {
    const existing = await getWhatsAppConfig(id)
    if (!existing) {
      throw new Error(`Configuración ${id} no encontrada`)
    }

    const updated = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    }

    const key = `whatsapp_config:${id}`
    await redis.set(key, JSON.stringify(updated))

    return updated
  } catch (error) {
    console.error("[DB] Error actualizando configuración:", error)
    throw error
  }
}

// Función para actualizar estadísticas de WhatsApp
export async function updateWhatsAppStats(
  id: string,
  stats: {
    messagesReceived?: number
    messagesProcessed?: number
    errors?: number
    lastMessageAt?: string
  },
) {
  try {
    const existing = await getWhatsAppConfig(id)
    if (!existing) {
      throw new Error(`Configuración ${id} no encontrada`)
    }

    const updatedStats = {
      ...existing.stats,
      ...stats,
    }

    // Si se pasan incrementos, sumarlos a los valores existentes
    if (stats.messagesReceived !== undefined) {
      updatedStats.messagesReceived = existing.stats.messagesReceived + stats.messagesReceived
    }
    if (stats.messagesProcessed !== undefined) {
      updatedStats.messagesProcessed = existing.stats.messagesProcessed + stats.messagesProcessed
    }
    if (stats.errors !== undefined) {
      updatedStats.errors = existing.stats.errors + stats.errors
    }
    if (stats.lastMessageAt !== undefined) {
      updatedStats.lastMessageAt = stats.lastMessageAt
    }

    const updated = {
      ...existing,
      stats: updatedStats,
      updatedAt: new Date().toISOString(),
    }

    const key = `whatsapp_config:${id}`
    await redis.set(key, JSON.stringify(updated))

    return updated
  } catch (error) {
    console.error("[DB] Error actualizando estadísticas:", error)
    throw error
  }
}

// Función para eliminar configuración de WhatsApp
export async function deleteWhatsAppConfig(id: string) {
  try {
    const key = `whatsapp_config:${id}`
    await redis.del(key)
    return true
  } catch (error) {
    console.error("[DB] Error eliminando configuración:", error)
    throw error
  }
}

// Función para listar todas las configuraciones de WhatsApp
export async function listWhatsAppConfigs(): Promise<WhatsAppConfig[]> {
  try {
    const keys = await redis.keys("whatsapp_config:*")
    const configs: WhatsAppConfig[] = []

    for (const key of keys) {
      const data = await redis.get(key)
      if (data) {
        if (typeof data === "string") {
          configs.push(JSON.parse(data))
        } else {
          configs.push(data as WhatsAppConfig)
        }
      }
    }

    return configs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  } catch (error) {
    console.error("[DB] Error listando configuraciones:", error)
    return []
  }
}

// ⬇️⬇️ Add right after the `listWhatsAppConfigs` declaration
export async function getAllWhatsAppConfigs() {
  return listWhatsAppConfigs()
}

// ⬇️⬇️ Insert below the previous snippet
export async function getConfigByClienteId(clienteId: string) {
  const configs = await listWhatsAppConfigs()
  return configs.find((c) => c.cliente_id === clienteId) || null
}

// Alias (se usan en otros archivos)
export const getWhatsappConfigByClienteId = getConfigByClienteId

// Función para obtener thread para un usuario
export async function getThreadForUser(
  phoneNumber: string,
  whatsappConfigId: string,
): Promise<{ threadId: string; isNewThread: boolean; isResetThread?: boolean }> {
  try {
    const key = `thread:${phoneNumber}:${whatsappConfigId}`
    const data = await redis.get(key)

    if (data) {
      let threadInfo: ThreadInfo

      if (typeof data === "string") {
        threadInfo = JSON.parse(data)
      } else {
        threadInfo = data as ThreadInfo
      }

      // Actualizar última actividad
      threadInfo.lastMessageAt = new Date().toISOString()
      threadInfo.messageCount = (threadInfo.messageCount || 0) + 1

      await redis.set(key, JSON.stringify(threadInfo))

      return {
        threadId: threadInfo.threadId,
        isNewThread: false,
        isResetThread: threadInfo.isResetThread || false,
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
      whatsappConfigId,
      lastMessageAt: new Date().toISOString(),
      messageCount: 1,
    }

    await redis.set(key, JSON.stringify(threadInfo))

    return {
      threadId: thread.id,
      isNewThread: true,
    }
  } catch (error) {
    console.error("[DB] Error obteniendo thread:", error)
    throw error
  }
}

// Función para resetear thread de un usuario
export async function resetThreadForUser(
  phoneNumber: string,
  whatsappConfigId: string,
): Promise<{ threadId: string; isNewThread: boolean; isResetThread: boolean }> {
  try {
    const key = `thread:${phoneNumber}:${whatsappConfigId}`

    // Crear nuevo thread
    const openai = new (await import("openai")).default({
      apiKey: process.env.OPENAI_API_KEY,
    })

    const thread = await openai.beta.threads.create()

    const threadInfo: ThreadInfo = {
      threadId: thread.id,
      phoneNumber,
      whatsappConfigId,
      lastMessageAt: new Date().toISOString(),
      messageCount: 1,
      isResetThread: true,
    }

    await redis.set(key, JSON.stringify(threadInfo))

    return {
      threadId: thread.id,
      isNewThread: true,
      isResetThread: true,
    }
  } catch (error) {
    console.error("[DB] Error reseteando thread:", error)
    throw error
  }
}

// Función para generar ID único
function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

// Función para obtener estadísticas del dashboard
export async function getDashboardStats() {
  try {
    const configs = await listWhatsAppConfigs()

    const totalConfigs = configs.length
    const activeConfigs = configs.filter((c) => c.active).length
    const totalMessages = configs.reduce((sum, c) => sum + c.stats.messagesReceived, 0)
    const totalProcessed = configs.reduce((sum, c) => sum + c.stats.messagesProcessed, 0)
    const totalErrors = configs.reduce((sum, c) => sum + c.stats.errors, 0)

    return {
      totalConfigs,
      activeConfigs,
      totalMessages,
      totalProcessed,
      totalErrors,
      successRate: totalMessages > 0 ? ((totalProcessed / totalMessages) * 100).toFixed(2) : "0",
    }
  } catch (error) {
    console.error("[DB] Error obteniendo estadísticas:", error)
    return {
      totalConfigs: 0,
      activeConfigs: 0,
      totalMessages: 0,
      totalProcessed: 0,
      totalErrors: 0,
      successRate: "0",
    }
  }
}

// ⬇️⬇️ Add after `getDashboardStats`

export async function getSystemStats() {
  return getDashboardStats()
}

// ⬇️⬇️ Place near other exports (e.g. bottom of file)

// Alias que otros módulos esperan
export const getConfigById = getWhatsAppConfig
export const getWhatsAppConfigById = getWhatsAppConfig
