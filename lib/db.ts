import { Redis } from "@upstash/redis"
import type { WhatsAppConfig, ThreadInfo, SystemStats } from "./types"
import { nanoid } from "nanoid"
import { normalizePhoneNumber } from "./utils"

// In-memory caches for configs and threads with TTL
// Config cache: 5 minutes TTL
const configCache = new Map<string, { config: WhatsAppConfig; timestamp: number }>()
const CONFIG_CACHE_TTL = 5 * 60 * 1000 // 5 minutos

// Phone to config ID cache: 5 minutes TTL
const phoneToConfigCache = new Map<string, { configId: string; timestamp: number }>()

// Thread cache: 3 minutes TTL
const threadCache = new Map<string, { thread: ThreadInfo; timestamp: number }>()
const THREAD_CACHE_TTL = 3 * 60 * 1000 // 3 minutos

export function clearAllCaches(): void {
  console.log("[DB] 🧹 Limpiando todos los cachés en memoria")
  configCache.clear()
  phoneToConfigCache.clear()
  threadCache.clear()
  console.log("[DB] ✅ Cachés limpiados exitosamente")
}

export function clearConfigCache(configId?: string): void {
  if (configId) {
    console.log(`[DB] 🧹 Limpiando caché para config: ${configId}`)
    configCache.delete(configId)
    // Also clear phone to config cache entries that point to this config
    for (const [phone, data] of phoneToConfigCache.entries()) {
      if (data.configId === configId) {
        phoneToConfigCache.delete(phone)
      }
    }
  } else {
    console.log("[DB] 🧹 Limpiando todos los cachés de configuración")
    configCache.clear()
    phoneToConfigCache.clear()
  }
  console.log("[DB] ✅ Caché de configuración limpiado")
}

// Inicializar el cliente de Redis
let redis: Redis | null = null

// Función para obtener el cliente de Redis
function getRedisClient() {
  if (redis) return redis

  try {
    // Inicializar el cliente de Redis usando las variables de entorno de Upstash
    redis = Redis.fromEnv()
    console.log("[DB] ✅ Cliente Redis inicializado correctamente")
    return redis
  } catch (error) {
    console.warn("[DB] ⚠️ Upstash Redis no está disponible:", error)
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
      console.error("[DB] Error al parsear JSON:", error)
      return null
    }
  }
  return data // Si ya es un objeto, devolverlo tal cual
}

// Función adicional para escanear claves de Redis de manera segura
async function scanRedisKeys(redisClient: Redis, pattern: string): Promise<string[]> {
  const allKeys: string[] = []
  let cursor = "0" // Usar string en lugar de number para el cursor

  do {
    const result = await redisClient.scan(cursor, {
      match: pattern,
      count: 100,
    })
    cursor = typeof result[0] === "number" ? result[0].toString() : result[0]
    allKeys.push(...result[1])
  } while (cursor !== "0") // Comparar con string "0"

  return allKeys
}

// Funciones para la gestión de configuraciones de WhatsApp

// Crear una nueva configuración
export async function createWhatsAppConfig(config: Partial<WhatsAppConfig>): Promise<WhatsAppConfig> {
  const id = config.id || nanoid()
  const now = new Date().toISOString()

  console.log(`[DB] 📝 Creando nueva configuración con ID: ${id}`)

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
    // Añadir configuraciones por defecto del widget
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
    // Nuevos campos para el botón flotante
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
    console.log(`[DB] 💾 Guardando configuración ${id} en Redis`)
    // Guardar en Redis - siempre como cadena JSON
    await redisClient.set(`${CONFIG_PREFIX}${id}`, JSON.stringify(newConfig))

    // Mapear el número de teléfono al ID de configuración
    if (newConfig.phoneNumberId) {
      await redisClient.set(`${PHONE_TO_CONFIG_PREFIX}${newConfig.phoneNumberId}`, id)
    }
  } else {
    console.log(`[DB] 💾 Guardando configuración ${id} en memoria`)
    // Fallback a memoria
    memoryStorage.configs.set(id, newConfig)
    if (newConfig.phoneNumberId) {
      memoryStorage.phoneToConfig.set(newConfig.phoneNumberId, id)
    }
  }

  // Actualizar estadísticas
  await updateSystemStats()

  console.log(`[DB] ✅ Configuración ${id} creada exitosamente`)
  return newConfig
}

// Obtener una configuración por ID
export async function getWhatsAppConfig(id: string): Promise<WhatsAppConfig | null> {
  try {
    const cached = configCache.get(id)
    if (cached && Date.now() - cached.timestamp < CONFIG_CACHE_TTL) {
      console.log(`[DB] ⚡ Config ${id} obtenida del caché en memoria`)
      return cached.config
    }

    console.log(`[DB] 🔍 Obteniendo configuración ${id}`)

    const redisClient = getRedisClient()

    if (redisClient) {
      console.log(`[DB] 🔍 Buscando en Redis con clave: ${CONFIG_PREFIX}${id}`)
      const configData = await redisClient.get(`${CONFIG_PREFIX}${id}`)

      if (!configData) {
        console.log(`[DB] ❌ Configuración ${id} no encontrada en Redis`)

        // Intentar listar todas las claves para debug
        try {
          const allKeys = await redisClient.keys(`${CONFIG_PREFIX}*`)
          console.log(`[DB] 🔍 Claves disponibles en Redis:`, allKeys)
        } catch (keyError) {
          console.error(`[DB] Error al listar claves:`, keyError)
        }

        return null
      }

      console.log(`[DB] 📄 Datos encontrados en Redis, deserializando...`)
      const config = safeJsonParse(configData)

      if (!config) {
        console.error(`[DB] ❌ Error al deserializar configuración ${id}`)
        return null
      }

      configCache.set(id, { config, timestamp: Date.now() })

      console.log(`[DB] ✅ Configuración ${id} obtenida exitosamente y guardada en caché`)
      console.log(`[DB] - displayName: ${config.displayName}`)
      console.log(`[DB] - cliente_id: ${config.cliente_id}`)
      return config
    } else {
      console.log(`[DB] 🔍 Buscando en memoria`)
      const config = memoryStorage.configs.get(id) || null
      console.log(`[DB] Configuración ${id} obtenida de memoria:`, config ? "encontrada" : "no encontrada")

      if (!config) {
        console.log(`[DB] 🔍 Configuraciones disponibles en memoria:`, Array.from(memoryStorage.configs.keys()))
      }

      if (config) {
        configCache.set(id, { config, timestamp: Date.now() })
      }

      return config
    }
  } catch (error) {
    console.error(`[DB] ❌ ERROR CRÍTICO al obtener configuración ${id}:`, error)
    console.error(`[DB] Stack trace:`, error instanceof Error ? error.stack : "No stack trace available")
    return null
  }
}

// Obtener una configuración por ID de número de teléfono
export async function getWhatsAppConfigByPhoneId(phoneNumberId: string): Promise<WhatsAppConfig | null> {
  const cachedMapping = phoneToConfigCache.get(phoneNumberId)
  if (cachedMapping && Date.now() - cachedMapping.timestamp < CONFIG_CACHE_TTL) {
    console.log(`[DB] ⚡ Mapeo de phone ${phoneNumberId} obtenido del caché`)
    return getWhatsAppConfig(cachedMapping.configId)
  }

  const redisClient = getRedisClient()

  if (redisClient) {
    const key = `${PHONE_TO_CONFIG_PREFIX}${phoneNumberId}`
    const configId = await redisClient.get(key)

    if (!configId) {
      const allConfigs = await getAllWhatsAppConfigs()
      const manualMatch = allConfigs.find((c) => c.phoneNumberId === phoneNumberId)

      if (manualMatch) {
        await redisClient.set(key, manualMatch.id)
        phoneToConfigCache.set(phoneNumberId, { configId: manualMatch.id, timestamp: Date.now() })
        return manualMatch
      }

      return null
    }

    phoneToConfigCache.set(phoneNumberId, { configId: configId as string, timestamp: Date.now() })

    const config = await getWhatsAppConfig(configId as string)
    return config
  } else {
    const configId = memoryStorage.phoneToConfig.get(phoneNumberId)

    if (!configId) {
      const allConfigs = Array.from(memoryStorage.configs.values())
      const manualMatch = allConfigs.find((c) => c.phoneNumberId === phoneNumberId)

      if (manualMatch) {
        memoryStorage.phoneToConfig.set(phoneNumberId, manualMatch.id)
        phoneToConfigCache.set(phoneNumberId, { configId: manualMatch.id, timestamp: Date.now() })
        return manualMatch
      }

      return null
    }

    phoneToConfigCache.set(phoneNumberId, { configId, timestamp: Date.now() })

    return memoryStorage.configs.get(configId) || null
  }
}

// Obtener todas las configuraciones
export async function getAllWhatsAppConfigs(): Promise<WhatsAppConfig[]> {
  try {
    console.log(`[DB] 📋 Obteniendo todas las configuraciones`)

    const redisClient = getRedisClient()

    if (redisClient) {
      console.log(`[DB] 🔍 Buscando en Redis`)
      const keys = await scanRedisKeys(redisClient, `${CONFIG_PREFIX}*`)
      console.log(`[DB] 📊 Encontradas ${keys.length} claves en Redis`)

      if (keys.length === 0) {
        console.log(`[DB] ⚠️ No hay configuraciones en Redis`)
        return []
      }

      const configs = await Promise.all(
        keys.map(async (key) => {
          console.log(`[DB] 📄 Procesando clave: ${key}`)
          const configData = await redisClient.get(key)
          // Usar la función auxiliar para manejar la deserialización
          const config = safeJsonParse(configData)
          if (config) {
            console.log(`[DB] ✅ Configuración deserializada: ${config.displayName} (${config.id})`)
          } else {
            console.log(`[DB] ❌ Error al deserializar configuración de clave: ${key}`)
          }
          return config
        }),
      )

      const validConfigs = configs.filter(Boolean) as WhatsAppConfig[]
      console.log(`[DB] ✅ Total de configuraciones válidas: ${validConfigs.length}`)
      return validConfigs
    } else {
      console.log(`[DB] 🔍 Buscando en memoria`)
      // Fallback a memoria
      const configs = Array.from(memoryStorage.configs.values())
      console.log(`[DB] 📊 Encontradas ${configs.length} configuraciones en memoria`)
      return configs
    }
  } catch (error) {
    console.error(`[DB] ❌ ERROR CRÍTICO al obtener todas las configuraciones:`, error)
    console.error(`[DB] Stack trace:`, error instanceof Error ? error.stack : "No stack trace available")
    return []
  }
}

// Actualizar una configuración
export async function updateWhatsAppConfig(
  id: string,
  updates: Partial<WhatsAppConfig>,
): Promise<WhatsAppConfig | null> {
  try {
    console.log(`[DB] 🔄 Actualizando configuración ${id} con:`, updates)

    const config = await getWhatsAppConfig(id)
    if (!config) {
      console.log(`[DB] ❌ Configuración ${id} no encontrada`)
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

      clearConfigCache(id)

      console.log(`[DB] ✅ Configuración ${id} actualizada exitosamente y caché limpiado`)
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

      clearConfigCache(id)

      console.log(`[DB] ✅ Configuración ${id} actualizada en memoria y caché limpiado`)
      return updatedConfig
    }
  } catch (error) {
    console.error(`[DB] ❌ Error al actualizar configuración ${id}:`, error)
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

// Función para obtener configuración por clienteId - NUEVA FUNCIÓN AGREGADA
export async function getConfigByClienteId(clienteId: string): Promise<WhatsAppConfig | null> {
  try {
    console.log(`[DB] 🔍 Buscando configuración para cliente_id: ${clienteId}`)

    const configs = await getAllWhatsAppConfigs()
    console.log(`[DB] 📊 Total de configuraciones disponibles: ${configs.length}`)

    if (configs.length > 0) {
      console.log(`[DB] 🔍 IDs de configuraciones disponibles:`)
      configs.forEach((config, index) => {
        console.log(
          `[DB]   ${index + 1}. ID: ${config.id}, cliente_id: ${config.cliente_id}, displayName: ${config.displayName}`,
        )
      })
    }

    const config = configs.find((config) => config.cliente_id === clienteId)

    if (config) {
      console.log(`[DB] ✅ Configuración encontrada para cliente_id ${clienteId}:`)
      console.log(`[DB] - ID: ${config.id}`)
      console.log(`[DB] - displayName: ${config.displayName}`)
      return config
    }

    console.log(`[DB] ❌ No se encontró configuración para cliente_id: ${clienteId}`)
    return null
  } catch (error) {
    console.error(`[DB] ❌ ERROR CRÍTICO al buscar configuración por cliente_id:`, error)
    console.error(`[DB] Stack trace:`, error instanceof Error ? error.stack : "No stack trace available")
    return null
  }
}

// Funciones para la gestión de threads

// Obtener o crear un thread para un usuario y configuración
export async function getThreadForUser(
  phoneNumber: string,
  whatsappConfigId: string,
): Promise<{ threadId: string; isNewThread: boolean; isResetThread?: boolean }> {
  const normalizedPhone = normalizePhoneNumber(phoneNumber)
  const key = `${THREAD_PREFIX}${normalizedPhone}:${whatsappConfigId}`

  const cachedThread = threadCache.get(key)
  if (cachedThread && Date.now() - cachedThread.timestamp < THREAD_CACHE_TTL) {
    console.log(`[DB] ⚡ Thread para ${normalizedPhone} obtenido del caché en memoria`)

    // Update message count in cache
    const updatedThreadInfo = {
      ...cachedThread.thread,
      lastMessageAt: new Date().toISOString(),
      messageCount: (cachedThread.thread.messageCount || 0) + 1,
      isResetThread: false,
    }

    // Update cache
    threadCache.set(key, { thread: updatedThreadInfo, timestamp: Date.now() })

    // Update in Redis/memory in background (don't await)
    const redisClient = getRedisClient()
    if (redisClient) {
      redisClient
        .set(key, JSON.stringify(updatedThreadInfo))
        .catch((err) => console.error("[DB] Error updating thread in Redis:", err))
    } else {
      memoryStorage.threads.set(key, updatedThreadInfo)
    }

    return {
      threadId: cachedThread.thread.threadId,
      isNewThread: false,
      isResetThread: cachedThread.thread.isResetThread === true,
    }
  }

  const redisClient = getRedisClient()

  console.log(`[DB] 🔍 Obteniendo thread para ${normalizedPhone} con config ${whatsappConfigId}`)

  if (redisClient) {
    const threadData = await redisClient.get(key)
    const threadInfo = safeJsonParse(threadData)

    if (threadInfo) {
      console.log(`[DB] ✅ Thread encontrado: ${threadInfo.threadId}`)

      const isResetThread = threadInfo.isResetThread === true

      const updatedThreadInfo = {
        ...threadInfo,
        lastMessageAt: new Date().toISOString(),
        messageCount: (threadInfo.messageCount || 0) + 1,
        isResetThread: false,
      }

      await redisClient.set(key, JSON.stringify(updatedThreadInfo))

      threadCache.set(key, { thread: updatedThreadInfo, timestamp: Date.now() })

      return {
        threadId: threadInfo.threadId,
        isNewThread: false,
        isResetThread,
      }
    }
  } else {
    const threadInfo = memoryStorage.threads.get(key)

    if (threadInfo) {
      console.log(`[DB] ✅ Thread encontrado en memoria: ${threadInfo.threadId}`)

      const isResetThread = threadInfo.isResetThread === true

      const updatedThreadInfo = {
        ...threadInfo,
        lastMessageAt: new Date().toISOString(),
        messageCount: (threadInfo.messageCount || 0) + 1,
        isResetThread: false,
      }

      memoryStorage.threads.set(key, updatedThreadInfo)

      threadCache.set(key, { thread: updatedThreadInfo, timestamp: Date.now() })

      return {
        threadId: threadInfo.threadId,
        isNewThread: false,
        isResetThread,
      }
    }
  }

  // Crear un nuevo thread
  console.log(`[DB] 📝 No se encontró thread existente, creando uno nuevo`)
  const openai = new (await import("openai")).default({
    apiKey: process.env.OPENAI_API_KEY,
  })

  const thread = await openai.beta.threads.create()
  console.log(`[DB] ✅ Nuevo thread creado: ${thread.id}`)

  const newThreadInfo: ThreadInfo = {
    threadId: thread.id,
    phoneNumber: normalizedPhone,
    whatsappConfigId,
    lastMessageAt: new Date().toISOString(),
    messageCount: 1,
  }

  if (redisClient) {
    await redisClient.set(key, JSON.stringify(newThreadInfo))
  } else {
    memoryStorage.threads.set(key, newThreadInfo)
  }

  threadCache.set(key, { thread: newThreadInfo, timestamp: Date.now() })

  await updateSystemStats()

  return { threadId: thread.id, isNewThread: true }
}

// Resetear un thread para un usuario - OPTIMIZADO
export async function resetThreadForUser(
  phoneNumber: string,
  whatsappConfigId: string,
): Promise<{ threadId: string; isNewThread: boolean }> {
  const normalizedPhone = normalizePhoneNumber(phoneNumber)
  const key = `${THREAD_PREFIX}${normalizedPhone}:${whatsappConfigId}`

  threadCache.delete(key)

  const redisClient = getRedisClient()

  console.log(`[DB] 🔄 RESETEANDO thread para ${normalizedPhone} con config ${whatsappConfigId}`)

  try {
    const openai = new (await import("openai")).default({
      apiKey: process.env.OPENAI_API_KEY,
    })

    let oldThreadId: string | null = null
    if (redisClient) {
      const oldThreadData = await redisClient.get(key)
      const oldThreadInfo = safeJsonParse(oldThreadData)
      if (oldThreadInfo) {
        oldThreadId = oldThreadInfo.threadId
        console.log(`[DB] 📋 Thread anterior encontrado: ${oldThreadId}`)
      }
    } else {
      const oldThreadInfo = memoryStorage.threads.get(key)
      if (oldThreadInfo) {
        oldThreadId = oldThreadInfo.threadId
        console.log(`[DB] 📋 Thread anterior encontrado en memoria: ${oldThreadId}`)
      }
    }

    if (oldThreadId) {
      try {
        await openai.beta.threads.delete(oldThreadId)
        console.log(`[DB] 🗑️ Thread anterior ELIMINADO de OpenAI: ${oldThreadId}`)
      } catch (deleteError) {
        console.warn(`[DB] ⚠️ No se pudo eliminar el thread anterior de OpenAI: ${deleteError.message}`)
      }
    }

    const newThread = await openai.beta.threads.create({
      metadata: {
        phoneNumber: normalizedPhone,
        whatsappConfigId,
        createdAt: new Date().toISOString(),
        isReset: "true",
      },
    })
    console.log(`[DB] ✅ NUEVO thread creado en OpenAI: ${newThread.id}`)

    if (redisClient) {
      await redisClient.del(key)
      console.log(`[DB] 🗑️ Thread anterior eliminado de Redis`)
    } else {
      memoryStorage.threads.delete(key)
      console.log(`[DB] 🗑️ Thread anterior eliminado de memoria`)
    }

    const newThreadInfo: ThreadInfo = {
      threadId: newThread.id,
      phoneNumber: normalizedPhone,
      whatsappConfigId,
      lastMessageAt: new Date().toISOString(),
      messageCount: 0,
      isResetThread: true,
      createdAt: new Date().toISOString(),
    }

    if (redisClient) {
      await redisClient.set(key, JSON.stringify(newThreadInfo))
      console.log(`[DB] 💾 Nuevo thread guardado en Redis: ${newThread.id}`)
    } else {
      memoryStorage.threads.set(key, newThreadInfo)
      console.log(`[DB] 💾 Nuevo thread guardado en memoria: ${newThread.id}`)
    }

    threadCache.set(key, { thread: newThreadInfo, timestamp: Date.now() })

    console.log(`[DB] ✅ RESET COMPLETADO EXITOSAMENTE`)
    console.log(`[DB] - Thread anterior: ${oldThreadId || "ninguno"} (ELIMINADO de OpenAI)`)
    console.log(`[DB] - Thread nuevo: ${newThread.id} (CREADO en OpenAI)`)

    return { threadId: newThread.id, isNewThread: true }
  } catch (error) {
    console.error(`[DB] ❌ Error al resetear thread:`, error)
    console.error(`[DB] Error details:`, {
      message: error.message,
      stack: error.stack,
      phoneNumber: normalizedPhone,
      whatsappConfigId,
    })
    throw error
  }
}

// Obtener todos los threads
export async function getAllThreads(): Promise<ThreadInfo[]> {
  const redisClient = getRedisClient()

  if (redisClient) {
    const keys = await scanRedisKeys(redisClient, `${THREAD_PREFIX}*`)

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

// Export alias for compatibility
export const getWhatsappConfigByClienteId = getConfigByClienteId
export const getConfigById = getWhatsAppConfig // Alias para compatibilidad
export const getWhatsAppConfigByClienteId = getConfigByClienteId
