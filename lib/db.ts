import { Redis } from "@upstash/redis"
import type { WhatsAppConfig, ThreadInfo, SystemStats } from "./types"
import { nanoid } from "nanoid"

// Inicializar el cliente de Redis
let redis: Redis | null = null

// Función para obtener el cliente de Redis
function getRedisClient() {
  if (redis) return redis

  try {
    // Inicializar el cliente de Redis usando las variables de entorno de Upstash
    redis = Redis.fromEnv()
    return redis
  } catch (error) {
    console.warn("Upstash Redis no está disponible:", error)
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
      console.error("Error al parsear JSON:", error)
      return null
    }
  }
  return data // Si ya es un objeto, devolverlo tal cual
}

// Funciones para la gestión de configuraciones de WhatsApp

// Crear una nueva configuración
export async function createWhatsAppConfig(config: Partial<WhatsAppConfig>): Promise<WhatsAppConfig> {
  const id = config.id || nanoid()
  const now = new Date().toISOString()

  const newConfig: WhatsAppConfig = {
    id,
    phoneNumberId: config.phoneNumberId || "",
    wabaId: config.wabaId || "",
    displayName: config.displayName || `WhatsApp ${id.slice(0, 6)}`,
    assistantId: config.assistantId || process.env.OPENAI_ASSISTANT_ID || "",
    active: config.active !== undefined ? config.active : true,
    createdAt: now,
    updatedAt: now,
    verifyToken: config.verifyToken || nanoid(16),
    accessToken: config.accessToken || "",
    webhookUrl: config.webhookUrl,
    stats: {
      messagesReceived: 0,
      messagesProcessed: 0,
      errors: 0,
    },
  }

  const redisClient = getRedisClient()

  if (redisClient) {
    // Guardar en Redis - siempre como cadena JSON
    await redisClient.set(`${CONFIG_PREFIX}${id}`, JSON.stringify(newConfig))

    // Mapear el número de teléfono al ID de configuración
    if (newConfig.phoneNumberId) {
      await redisClient.set(`${PHONE_TO_CONFIG_PREFIX}${newConfig.phoneNumberId}`, id)
    }
  } else {
    // Fallback a memoria
    memoryStorage.configs.set(id, newConfig)
    if (newConfig.phoneNumberId) {
      memoryStorage.phoneToConfig.set(newConfig.phoneNumberId, id)
    }
  }

  // Actualizar estadísticas
  await updateSystemStats()

  return newConfig
}

// Obtener una configuración por ID
export async function getWhatsAppConfig(id: string): Promise<WhatsAppConfig | null> {
  try {
    console.log(`[DB] Obteniendo configuración ${id}`)

    const redisClient = getRedisClient()

    if (redisClient) {
      const configData = await redisClient.get(`${CONFIG_PREFIX}${id}`)

      if (!configData) {
        console.log(`[DB] Configuración ${id} no encontrada en Redis`)
        return null
      }

      // Usar la función auxiliar para manejar la deserialización
      const config = safeJsonParse(configData)

      if (!config) {
        console.error(`[DB] Error al deserializar configuración ${id}`)
        return null
      }

      console.log(`[DB] Configuración ${id} obtenida exitosamente`)
      return config
    } else {
      // Fallback a memoria
      const config = memoryStorage.configs.get(id) || null
      console.log(`[DB] Configuración ${id} obtenida de memoria:`, config ? "encontrada" : "no encontrada")
      return config
    }
  } catch (error) {
    console.error(`[DB] Error al obtener configuración ${id}:`, error)
    return null
  }
}

// Obtener una configuración por ID de número de teléfono
export async function getWhatsAppConfigByPhoneId(phoneNumberId: string): Promise<WhatsAppConfig | null> {
  const redisClient = getRedisClient()

  if (redisClient) {
    // Intentar obtener el ID de configuración directamente
    const key = `${PHONE_TO_CONFIG_PREFIX}${phoneNumberId}`
    const configId = await redisClient.get(key)

    if (!configId) {
      // Si no encontramos el ID, intentamos buscar manualmente
      const allConfigs = await getAllWhatsAppConfigs()
      const manualMatch = allConfigs.find((c) => c.phoneNumberId === phoneNumberId)

      if (manualMatch) {
        // Corregir el mapeo en Redis
        await redisClient.set(key, manualMatch.id)
        return manualMatch
      }

      return null
    }

    const config = await getWhatsAppConfig(configId as string)
    return config
  } else {
    // Fallback a memoria
    const configId = memoryStorage.phoneToConfig.get(phoneNumberId)

    if (!configId) {
      // Si no encontramos el ID, intentamos buscar manualmente
      const allConfigs = Array.from(memoryStorage.configs.values())
      const manualMatch = allConfigs.find((c) => c.phoneNumberId === phoneNumberId)

      if (manualMatch) {
        // Corregir el mapeo en memoria
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
  const redisClient = getRedisClient()

  if (redisClient) {
    const keys = await redisClient.keys(`${CONFIG_PREFIX}*`)

    if (keys.length === 0) return []

    const configs = await Promise.all(
      keys.map(async (key) => {
        const configData = await redisClient.get(key)
        // Usar la función auxiliar para manejar la deserialización
        return safeJsonParse(configData)
      }),
    )

    return configs.filter(Boolean) as WhatsAppConfig[]
  } else {
    // Fallback a memoria
    return Array.from(memoryStorage.configs.values())
  }
}

// Actualizar una configuración
export async function updateWhatsAppConfig(
  id: string,
  updates: Partial<WhatsAppConfig>,
): Promise<WhatsAppConfig | null> {
  try {
    console.log(`[DB] Actualizando configuración ${id} con:`, updates)

    const config = await getWhatsAppConfig(id)
    if (!config) {
      console.log(`[DB] Configuración ${id} no encontrada`)
      return null
    }

    const redisClient = getRedisClient()

    if (redisClient) {
      // Si el phoneNumberId cambió, actualizar el mapeo
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

      // Guardar en Redis - siempre como cadena JSON
      const serializedConfig = JSON.stringify(updatedConfig)
      await redisClient.set(`${CONFIG_PREFIX}${id}`, serializedConfig)

      console.log(`[DB] Configuración ${id} actualizada exitosamente`)
      return updatedConfig
    } else {
      // Fallback a memoria
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
      console.log(`[DB] Configuración ${id} actualizada en memoria`)
      return updatedConfig
    }
  } catch (error) {
    console.error(`[DB] Error al actualizar configuración ${id}:`, error)
    throw error
  }
}

// Eliminar una configuración
export async function deleteWhatsAppConfig(id: string): Promise<boolean> {
  const config = await getWhatsAppConfig(id)
  if (!config) return false

  const redisClient = getRedisClient()

  if (redisClient) {
    // Eliminar el mapeo de número de teléfono
    if (config.phoneNumberId) {
      await redisClient.del(`${PHONE_TO_CONFIG_PREFIX}${config.phoneNumberId}`)
    }

    // Eliminar la configuración
    await redisClient.del(`${CONFIG_PREFIX}${id}`)
  } else {
    // Fallback a memoria
    if (config.phoneNumberId) {
      memoryStorage.phoneToConfig.delete(config.phoneNumberId)
    }
    memoryStorage.configs.delete(id)
  }

  // Actualizar estadísticas
  await updateSystemStats()

  return true
}

// Funciones para la gestión de threads

// Obtener o crear un thread para un usuario y configuración
export async function getThreadForUser(
  phoneNumber: string,
  whatsappConfigId: string,
): Promise<{ threadId: string; isNewThread: boolean; isResetThread?: boolean }> {
  const key = `${THREAD_PREFIX}${phoneNumber}:${whatsappConfigId}`
  const redisClient = getRedisClient()

  console.log(`[DB] Obteniendo thread para ${phoneNumber} con config ${whatsappConfigId}`)

  if (redisClient) {
    // Intentar obtener el thread existente
    const threadData = await redisClient.get(key)
    const threadInfo = safeJsonParse(threadData)

    if (threadInfo) {
      console.log(`[DB] Thread encontrado: ${threadInfo.threadId}`)

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
  } else {
    // Fallback a memoria con la misma lógica
    const threadInfo = memoryStorage.threads.get(key)

    if (threadInfo) {
      console.log(`[DB] Thread encontrado en memoria: ${threadInfo.threadId}`)

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
  console.log(`[DB] No se encontró thread existente, creando uno nuevo`)
  const openai = new (await import("openai")).default({
    apiKey: process.env.OPENAI_API_KEY,
  })

  const thread = await openai.beta.threads.create()
  console.log(`[DB] Nuevo thread creado: ${thread.id}`)

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
  } else {
    // Fallback a memoria
    memoryStorage.threads.set(key, newThreadInfo)
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
  const key = `${THREAD_PREFIX}${phoneNumber}:${whatsappConfigId}`
  const redisClient = getRedisClient()

  console.log(`[DB] RESETEANDO thread para ${phoneNumber} con config ${whatsappConfigId}`)

  try {
    // 1. CREAR UN THREAD COMPLETAMENTE NUEVO EN OPENAI
    const openai = new (await import("openai")).default({
      apiKey: process.env.OPENAI_API_KEY,
    })

    const newThread = await openai.beta.threads.create()
    console.log(`[DB] ✅ NUEVO thread creado en OpenAI: ${newThread.id}`)

    // 2. ELIMINAR COMPLETAMENTE EL THREAD ANTERIOR
    if (redisClient) {
      await redisClient.del(key)
      console.log(`[DB] ✅ Thread anterior eliminado de Redis`)
    } else {
      memoryStorage.threads.delete(key)
      console.log(`[DB] ✅ Thread anterior eliminado de memoria`)
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
    } else {
      memoryStorage.threads.set(key, newThreadInfo)
      console.log(`[DB] ✅ Nuevo thread guardado en memoria: ${newThread.id}`)
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
  const redisClient = getRedisClient()

  if (redisClient) {
    const keys = await redisClient.keys(`${THREAD_PREFIX}*`)

    if (keys.length === 0) return []

    const threads = await Promise.all(
      keys.map(async (key) => {
        const threadData = await redisClient.get(key)
        // Usar la función auxiliar para manejar la deserialización
        return safeJsonParse(threadData)
      }),
    )

    return threads.filter(Boolean) as ThreadInfo[]
  } else {
    // Fallback a memoria
    return Array.from(memoryStorage.threads.values())
  }
}

// Funciones para estadísticas del sistema

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
    // Guardar en Redis - siempre como cadena JSON
    await redisClient.set(STATS_KEY, JSON.stringify(stats))
  } else {
    // Fallback a memoria
    memoryStorage.stats = stats
  }

  return stats
}

// Obtener estadísticas del sistema
export async function getSystemStats(): Promise<SystemStats> {
  const redisClient = getRedisClient()

  if (redisClient) {
    const statsData = await redisClient.get(STATS_KEY)
    // Usar la función auxiliar para manejar la deserialización
    const stats = safeJsonParse(statsData)

    if (!stats) {
      return updateSystemStats()
    }

    return stats
  } else {
    // Fallback a memoria
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

// Función adicional para obtener configuración por ID (alias para compatibilidad)
export async function getWhatsAppConfigById(id: string): Promise<WhatsAppConfig | null> {
  return getWhatsAppConfig(id)
}

// Función para obtener configuración por clienteId
export async function getConfigByClienteId(clienteId: string): Promise<WhatsAppConfig | null> {
  try {
    const configs = await getAllWhatsAppConfigs()
    return configs.find((config) => config.cliente_id === clienteId)
  } catch (error) {
    console.error("Error al buscar configuración por cliente_id:", error)
    return null
  }
}
