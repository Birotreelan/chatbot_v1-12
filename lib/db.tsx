import { Redis } from "@upstash/redis"
import type { WhatsAppConfig, ThreadInfo, SystemStats } from "./types"
import { nanoid } from "nanoid"
import { normalizePhoneNumber } from "./utils"
import { withLock } from "./distributed-lock"

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

const THREAD_EXPIRY_HOURS = Number.parseInt(process.env.THREAD_EXPIRY_HOURS || "24", 10)

// Función auxiliar para verificar si un thread ha expirado
function isThreadExpired(threadInfo: ThreadInfo): boolean {
  if (!threadInfo.createdAt) {
    // Si no tiene createdAt, usar lastMessageAt como fallback
    const lastMessage = new Date(threadInfo.lastMessageAt)
    const now = new Date()
    const hoursDiff = (now.getTime() - lastMessage.getTime()) / (1000 * 60 * 60)
    return hoursDiff >= THREAD_EXPIRY_HOURS
  }

  const createdAt = new Date(threadInfo.createdAt)
  const now = new Date()
  const hoursDiff = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60)

  console.log(`[DB] 🕐 Thread creado hace ${hoursDiff.toFixed(2)} horas (expira a las ${THREAD_EXPIRY_HOURS} horas)`)

  return hoursDiff >= THREAD_EXPIRY_HOURS
}

// Función auxiliar para manejar la serialización/deserialización segura
function safeJsonParse(data: any, key?: string): any {
  if (typeof data === "string") {
    if (data.startsWith("thread_") && key?.includes(THREAD_PREFIX)) {
      console.log(`[DB] 🧹 Detectado thread en formato antiguo: ${data.substring(0, 20)}... - será eliminado`)
      return null // Retornar null para que sea filtrado y eliminado
    }

    try {
      return JSON.parse(data)
    } catch (error) {
      if (!data.startsWith("thread_")) {
        console.error("[DB] Error al parsear JSON:", error)
      }
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
    additionalAssistants: config.additionalAssistants || [],
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
      // Usar la función auxiliar para manejar la deserialización
      const config = safeJsonParse(configData)

      if (!config) {
        console.error(`[DB] ❌ Error al deserializar configuración ${id}`)
        return null
      }

      console.log(`[DB] ✅ Configuración ${id} obtenida exitosamente`)
      console.log(`[DB] - displayName: ${config.displayName}`)
      console.log(`[DB] - cliente_id: ${config.cliente_id}`)
      return config
    } else {
      console.log(`[DB] 🔍 Buscando en memoria`)
      // Fallback a memoria
      const config = memoryStorage.configs.get(id) || null
      console.log(`[DB] Configuración ${id} obtenida de memoria:`, config ? "encontrada" : "no encontrada")

      if (!config) {
        console.log(`[DB] 🔍 Configuraciones disponibles en memoria:`, Array.from(memoryStorage.configs.keys()))
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

      console.log(`[DB] ✅ Configuración ${id} actualizada exitosamente`)
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
      console.log(`[DB] ✅ Configuración ${id} actualizada en memoria`)
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
  const lockKey = `thread:${normalizedPhone}:${whatsappConfigId}`

  console.log(`[DB] 🔍 Obteniendo thread para ${normalizedPhone} con config ${whatsappConfigId}`)

  return withLock(
    lockKey,
    async () => {
      const key = `${THREAD_PREFIX}${normalizedPhone}:${whatsappConfigId}`
      const redisClient = getRedisClient()

      if (redisClient) {
        // Intentar obtener el thread existente
        const threadData = await redisClient.get(key)
        const threadInfo = safeJsonParse(threadData, key)

        if (threadInfo) {
          if (isThreadExpired(threadInfo)) {
            console.log(`[DB] ⏰ Thread ${threadInfo.threadId} ha EXPIRADO. Creando uno nuevo...`)

            // Eliminar el thread antiguo de OpenAI
            try {
              const openai = new (await import("openai")).default({
                apiKey: process.env.OPENAI_API_KEY,
              })
              await openai.beta.threads.delete(threadInfo.threadId)
              console.log(`[DB] 🗑️ Thread expirado eliminado de OpenAI: ${threadInfo.threadId}`)
            } catch (deleteError: any) {
              console.warn(`[DB] ⚠️ No se pudo eliminar thread expirado de OpenAI: ${deleteError.message}`)
            }

            // Eliminar de Redis
            await redisClient.del(key)
            console.log(`[DB] 🗑️ Thread expirado eliminado de Redis`)

            // Continuar para crear uno nuevo (el código abajo lo manejará)
          } else {
            console.log(`[DB] ✅ Thread encontrado y válido: ${threadInfo.threadId}`)

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
      } else {
        // Fallback a memoria con la misma lógica
        const threadInfo = memoryStorage.threads.get(key)

        if (threadInfo) {
          if (isThreadExpired(threadInfo)) {
            console.log(`[DB] ⏰ Thread ${threadInfo.threadId} en memoria ha EXPIRADO. Creando uno nuevo...`)

            // Eliminar el thread antiguo de OpenAI
            try {
              const openai = new (await import("openai")).default({
                apiKey: process.env.OPENAI_API_KEY,
              })
              await openai.beta.threads.delete(threadInfo.threadId)
              console.log(`[DB] 🗑️ Thread expirado eliminado de OpenAI: ${threadInfo.threadId}`)
            } catch (deleteError: any) {
              console.warn(`[DB] ⚠️ No se pudo eliminar thread expirado de OpenAI: ${deleteError.message}`)
            }

            // Eliminar de memoria
            memoryStorage.threads.delete(key)
            console.log(`[DB] 🗑️ Thread expirado eliminado de memoria`)

            // Continuar para crear uno nuevo
          } else {
            console.log(`[DB] ✅ Thread encontrado en memoria y válido: ${threadInfo.threadId}`)

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
      }

      // Crear un nuevo thread
      console.log(`[DB] 📝 No se encontró thread existente o expiró, creando uno nuevo`)
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
        createdAt: new Date().toISOString(), // Importante para la expiración
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
    },
    30, // Lock timeout de 30 segundos
    15, // Máximo 15 reintentos (1.5 segundos total de espera)
  )
}

// Resetear un thread para un usuario - OPTIMIZADO
export async function resetThreadForUser(
  phoneNumber: string,
  whatsappConfigId: string,
): Promise<{ threadId: string; isNewThread: boolean }> {
  const normalizedPhone = normalizePhoneNumber(phoneNumber)
  const lockKey = `thread:${normalizedPhone}:${whatsappConfigId}`

  console.log(`[DB] 🔄 RESETEANDO thread para ${normalizedPhone} con config ${whatsappConfigId}`)

  return withLock(
    lockKey,
    async () => {
      const key = `${THREAD_PREFIX}${normalizedPhone}:${whatsappConfigId}`
      const redisClient = getRedisClient()

      try {
        const openai = new (await import("openai")).default({
          apiKey: process.env.OPENAI_API_KEY,
        })

        // 1. OBTENER EL THREAD ANTERIOR (si existe)
        let oldThreadId: string | null = null
        if (redisClient) {
          const oldThreadData = await redisClient.get(key)
          const oldThreadInfo = safeJsonParse(oldThreadData, key)
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
            // Continuar aunque falle la eliminación
          }
        }

        // 2. CREAR UN THREAD COMPLETAMENTE NUEVO EN OPENAI
        const newThread = await openai.beta.threads.create({
          metadata: {
            phoneNumber: normalizedPhone,
            whatsappConfigId,
            createdAt: new Date().toISOString(),
            isReset: "true",
          },
        })
        console.log(`[DB] ✅ NUEVO thread creado en OpenAI: ${newThread.id}`)

        // 3. ELIMINAR COMPLETAMENTE EL THREAD ANTERIOR DE REDIS/MEMORIA
        if (redisClient) {
          await redisClient.del(key)
          console.log(`[DB] 🗑️ Thread anterior eliminado de Redis`)
        } else {
          memoryStorage.threads.delete(key)
          console.log(`[DB] 🗑️ Thread anterior eliminado de memoria`)
        }

        // 4. GUARDAR EL NUEVO THREAD CON FLAG DE RESET
        const newThreadInfo: ThreadInfo = {
          threadId: newThread.id,
          phoneNumber: normalizedPhone,
          whatsappConfigId,
          lastMessageAt: new Date().toISOString(),
          messageCount: 0, // Empezar en 0 para que se considere nuevo
          isResetThread: true, // Flag para indicar que es un thread reseteado
          createdAt: new Date().toISOString(),
        }

        if (redisClient) {
          await redisClient.set(key, JSON.stringify(newThreadInfo))
          console.log(`[DB] 💾 Nuevo thread guardado en Redis: ${newThread.id}`)
        } else {
          memoryStorage.threads.set(key, newThreadInfo)
          console.log(`[DB] 💾 Nuevo thread guardado en memoria: ${newThread.id}`)
        }

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
    },
    60, // Lock timeout de 60 segundos para reset (operación más larga)
    20, // Máximo 20 reintentos
  )
}

// Obtener todos los threads
export async function getAllThreads(): Promise<ThreadInfo[]> {
  const redisClient = getRedisClient()

  if (redisClient) {
    const keys = await scanRedisKeys(redisClient, `${THREAD_PREFIX}*`)

    if (keys.length === 0) return []

    const threadsWithKeys = await Promise.all(
      keys.map(async (key) => {
        const threadData = await redisClient.get(key)
        // Pasar la clave para que safeJsonParse pueda detectar threads antiguos
        const parsed = safeJsonParse(threadData, key)
        return { key, data: parsed }
      }),
    )

    const keysToDelete = threadsWithKeys.filter(({ data }) => data === null).map(({ key }) => key)

    if (keysToDelete.length > 0) {
      console.log(`[DB] 🧹 Limpiando ${keysToDelete.length} threads en formato antiguo de Redis`)
      await Promise.all(keysToDelete.map((key) => redisClient.del(key)))
    }

    // Retornar solo los threads válidos
    const validThreads = threadsWithKeys.filter(({ data }) => data !== null).map(({ data }) => data) as ThreadInfo[]

    return validThreads
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

export async function getThread(userIdentifier: string, configId: string): Promise<{ thread_id: string } | null> {
  console.log(`[DB] 🔍 getThread llamado para ${userIdentifier}, config: ${configId}`)

  const normalizedIdentifier = normalizePhoneNumber(userIdentifier)
  const key = `${THREAD_PREFIX}${normalizedIdentifier}:${configId}`
  const redisClient = getRedisClient()

  if (redisClient) {
    const threadData = await redisClient.get(key)
    const threadInfo = safeJsonParse(threadData, key)

    if (threadInfo && threadInfo.threadId) {
      console.log(`[DB] ✅ Thread encontrado en Redis: ${threadInfo.threadId}`)
      return { thread_id: threadInfo.threadId }
    }

    console.log(`[DB] ❌ Thread no encontrado en Redis`)
    return null
  } else {
    const threadInfo = memoryStorage.threads.get(key)

    if (threadInfo && threadInfo.threadId) {
      console.log(`[DB] ✅ Thread encontrado en memoria: ${threadInfo.threadId}`)
      return { thread_id: threadInfo.threadId }
    }

    console.log(`[DB] ❌ Thread no encontrado en memoria`)
    return null
  }
}

export async function setThread(userIdentifier: string, configId: string, threadId: string): Promise<void> {
  console.log(`[DB] 💾 setThread llamado para ${userIdentifier}, config: ${configId}, thread: ${threadId}`)

  const normalizedIdentifier = normalizePhoneNumber(userIdentifier)
  const key = `${THREAD_PREFIX}${normalizedIdentifier}:${configId}`
  const redisClient = getRedisClient()

  const threadInfo: ThreadInfo = {
    threadId,
    phoneNumber: normalizedIdentifier,
    whatsappConfigId: configId,
    lastMessageAt: new Date().toISOString(),
    messageCount: 1,
    createdAt: new Date().toISOString(),
  }

  if (redisClient) {
    // Para threads de WhatsApp, sin TTL (permanente)
    if (userIdentifier.startsWith("web_")) {
      await redisClient.set(key, JSON.stringify(threadInfo), { ex: 7200 })
      console.log(`[DB] ✅ Thread web guardado en Redis con TTL de 2 horas: ${threadId}`)
    } else {
      await redisClient.set(key, JSON.stringify(threadInfo))
      console.log(`[DB] ✅ Thread de WhatsApp guardado en Redis (permanente): ${threadId}`)
    }
  } else {
    memoryStorage.threads.set(key, threadInfo)
    console.log(`[DB] ✅ Thread guardado en memoria: ${threadId}`)
  }
}

export async function getSystemStatsFiltered(startDate?: string, endDate?: string): Promise<SystemStats> {
  const configs = await getAllWhatsAppConfigs()
  let threads = await getAllThreads()

  // Filtrar threads por rango de fechas si se proporcionan
  if (startDate || endDate) {
    const start = startDate ? new Date(startDate) : new Date(0)
    const end = endDate ? new Date(endDate) : new Date()

    // Ajustar el fin del día para incluir todo el día final
    end.setHours(23, 59, 59, 999)

    threads = threads.filter((thread) => {
      // Usar createdAt o lastMessageAt para filtrar
      const threadDate = new Date(thread.createdAt || thread.lastMessageAt)
      return threadDate >= start && threadDate <= end
    })
  }

  const stats: SystemStats = {
    totalConfigs: configs.length,
    activeConfigs: configs.filter((c) => c.active).length,
    totalMessages: threads.reduce((sum, t) => sum + (t.messageCount || 0), 0),
    totalThreads: threads.length,
    lastUpdated: new Date().toISOString(),
  }

  return stats
}

// Actualizar threadId con lock para evitar condiciones de carrera
export async function updateThreadId(
  phoneNumber: string,
  whatsappConfigId: string,
  newThreadId: string,
): Promise<void> {
  const normalizedPhone = normalizePhoneNumber(phoneNumber)
  const key = `${THREAD_PREFIX}${normalizedPhone}:${whatsappConfigId}`
  const lockKey = `thread:${normalizedPhone}:${whatsappConfigId}`

  console.log(`[DB] 🔄 Actualizando threadId para ${normalizedPhone} con config ${whatsappConfigId} -> ${newThreadId}`)

  await withLock(
    lockKey,
    async () => {
      const redisClient = getRedisClient()

      // Obtener el thread actual para preservar información
      let existingThreadInfo: ThreadInfo | null = null

      if (redisClient) {
        const threadData = await redisClient.get(key)
        existingThreadInfo = safeJsonParse(threadData, key)
      } else {
        existingThreadInfo = memoryStorage.threads.get(key) || null
      }

      const threadInfo: ThreadInfo = {
        threadId: newThreadId,
        phoneNumber: normalizedPhone,
        whatsappConfigId,
        lastMessageAt: new Date().toISOString(),
        messageCount: existingThreadInfo?.messageCount || 0, // Preserve message count
        createdAt: new Date().toISOString(), // New thread = new creation time
        isResetThread: false,
      }

      if (redisClient) {
        await redisClient.set(key, JSON.stringify(threadInfo))
        console.log(`[DB] ✅ ThreadId actualizado en Redis con lock: ${newThreadId}`)
      } else {
        memoryStorage.threads.set(key, threadInfo)
        console.log(`[DB] ✅ ThreadId actualizado en memoria con lock: ${newThreadId}`)
      }
    },
    30, // Lock timeout
    15, // Max retries
  )
}
