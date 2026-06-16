import { Redis } from "@upstash/redis"
import type { WhatsAppConfig, ThreadInfo, SystemStats, GlobalTemplate } from "./types"
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
    return redis
  } catch (error) {
    console.warn("[DB] Upstash Redis no está disponible:", error)
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

  return hoursDiff >= THREAD_EXPIRY_HOURS
}

// Función auxiliar para manejar la serialización/deserialización segura
function safeJsonParse(data: any, key?: string): any {
  if (typeof data === "string") {
    if (data.startsWith("thread_") && key?.includes(THREAD_PREFIX)) {
      return null // Thread en formato antiguo, será filtrado y eliminado
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
    const redisClient = getRedisClient()

    if (redisClient) {
      const configData = await redisClient.get(`${CONFIG_PREFIX}${id}`)

      if (!configData) return null

      // Usar la función auxiliar para manejar la deserialización
      const config = safeJsonParse(configData)

      if (!config) {
        console.error(`[DB] Error al deserializar configuración ${id}`)
        return null
      }

      return config
    } else {
      // Fallback a memoria
      return memoryStorage.configs.get(id) || null
    }
  } catch (error) {
    console.error(`[DB] Error al obtener configuración ${id}:`, error)
    return null
  }
}

// Obtener una configuración por ID de número de teléfono - SIEMPRE FRESCA (sin cachear)
export async function getWhatsAppConfigByPhoneIdFresh(phoneNumberId: string): Promise<WhatsAppConfig | null> {
  try {
    const allConfigs = await getAllWhatsAppConfigs()
    return allConfigs.find((c) => c.phoneNumberId === phoneNumberId) || null
  } catch (error) {
    console.error(`[DB] Error al obtener configuración fresca para ${phoneNumberId}:`, error)
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
    const redisClient = getRedisClient()

    if (redisClient) {
      const keys = await scanRedisKeys(redisClient, `${CONFIG_PREFIX}*`)
      if (keys.length === 0) return []

      const configs = await Promise.all(
        keys.map(async (key) => {
          const configData = await redisClient.get(key)
          return safeJsonParse(configData)
        }),
      )

      return configs.filter(Boolean) as WhatsAppConfig[]
    } else {
      // Fallback a memoria
      return Array.from(memoryStorage.configs.values())
    }
  } catch (error) {
    console.error(`[DB] Error al obtener todas las configuraciones:`, error)
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
    if (!config) return null

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

      // Eliminar la clave anterior de Redis para forzar lectura fresca
      await redisClient.del(`${CONFIG_PREFIX}${id}`)

      // Guardar en Redis - siempre como cadena JSON
      const serializedConfig = JSON.stringify(updatedConfig)
      await redisClient.set(`${CONFIG_PREFIX}${id}`, serializedConfig)

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

// Función para obtener configuración por clienteId - NUEVA FUNCIÓN AGREGADA
export async function getConfigByClienteId(clienteId: string): Promise<WhatsAppConfig | null> {
  try {
    const configs = await getAllWhatsAppConfigs()
    return configs.find((config) => config.cliente_id === clienteId) || null
  } catch (error) {
    console.error(`[DB] Error al buscar configuración por cliente_id ${clienteId}:`, error)
    return null
  }
}

export async function getWhatsAppConfigsByTenant(tenantId: string | null): Promise<WhatsAppConfig[]> {
  // Si tenantId es null, retornar TODAS (super admin)
  if (tenantId === null) {
    return await getAllWhatsAppConfigs()
  }

  // Si tenantId existe, filtrar solo ese cliente
  const allConfigs = await getAllWhatsAppConfigs()
  return allConfigs.filter((config) => config.cliente_id === tenantId)
}

// Funciones para la gestión de threads

// Obtener o crear un thread para un usuario y configuración
export async function getThreadForUser(
  phoneNumber: string,
  whatsappConfigId: string,
): Promise<{ threadId: string; isNewThread: boolean; isResetThread?: boolean; assistantId?: string }> {
  const normalizedPhone = normalizePhoneNumber(phoneNumber)
  const lockKey = `thread:${normalizedPhone}:${whatsappConfigId}`

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
            // Eliminar el thread antiguo de OpenAI
            try {
              const openai = new (await import("openai")).default({
                apiKey: process.env.OPENAI_API_KEY,
              })
              await openai.beta.threads.delete(threadInfo.threadId)
            } catch (deleteError: any) {
              console.warn(`[DB] No se pudo eliminar thread expirado de OpenAI: ${deleteError.message}`)
            }

            // Eliminar de Redis
            await redisClient.del(key)

            // Continuar para crear uno nuevo (el código abajo lo manejará)
          } else {
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
              assistantId: threadInfo.assistantId,
            }
          }
        }
      } else {
        // Fallback a memoria con la misma lógica
        const threadInfo = memoryStorage.threads.get(key)

        if (threadInfo) {
          if (isThreadExpired(threadInfo)) {
            // Eliminar el thread antiguo de OpenAI
            try {
              const openai = new (await import("openai")).default({
                apiKey: process.env.OPENAI_API_KEY,
              })
              await openai.beta.threads.delete(threadInfo.threadId)
            } catch (deleteError: any) {
              console.warn(`[DB] No se pudo eliminar thread expirado de OpenAI: ${deleteError.message}`)
            }

            // Eliminar de memoria
            memoryStorage.threads.delete(key)

            // Continuar para crear uno nuevo
          } else {
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
              assistantId: threadInfo.assistantId,
            }
          }
        }
      }

      // Crear un nuevo thread
      const openai = new (await import("openai")).default({
        apiKey: process.env.OPENAI_API_KEY,
      })

      const thread = await openai.beta.threads.create()
      console.info(`[DB] Nuevo thread creado: ${thread.id}`)

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
          }
        } else {
          const oldThreadInfo = memoryStorage.threads.get(key)
          if (oldThreadInfo) {
            oldThreadId = oldThreadInfo.threadId
          }
        }

        if (oldThreadId) {
          try {
            await openai.beta.threads.delete(oldThreadId)
          } catch (deleteError) {
            console.warn(`[DB] No se pudo eliminar el thread anterior de OpenAI: ${deleteError.message}`)
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

        // 3. ELIMINAR COMPLETAMENTE EL THREAD ANTERIOR DE REDIS/MEMORIA
        if (redisClient) {
          await redisClient.del(key)
        } else {
          memoryStorage.threads.delete(key)
        }

        // 4. GUARDAR EL NUEVO THREAD CON FLAG DE RESET
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
        } else {
          memoryStorage.threads.set(key, newThreadInfo)
        }

        console.info(`[DB] Thread reseteado: ${oldThreadId || "ninguno"} -> ${newThread.id}`)

        return { threadId: newThread.id, isNewThread: true }
      } catch (error) {
        console.error(`[DB] Error al resetear thread para ${normalizedPhone}:`, error)
        throw error
      }
    },
    60, // Lock timeout de 60 segundos para reset (operación más larga)
    20, // Máximo 20 reintentos
  )
}

/**
 * Limpia TODOS los estados de conversación almacenados en Redis para un usuario.
 * Esta función debe llamarse junto con resetThreadForUser para un reset completo.
 * 
 * Estados que se limpian:
 * - conv_context: Contexto de conversación general
 * - turn_selection: Selección de turnos  
 * - reschedule_flow: Flujo de reagendamiento
 * - post-action: Contexto post-acción
 * - patient_detection_state: Estado de detección de paciente
 * - new_patient_flow: Flujo de nuevo paciente
 * - dni_awaiting: Estado de espera de DNI
 * - booking_flow: Flujo de reserva
 * - existing_patient_flow: Flujo de paciente existente
 * - appointment_context: Contexto de cita
 * - appointment_flow: Estado de flujo de cita
 */
export async function clearAllConversationStates(
  phoneNumber: string,
  configId: string
): Promise<{ clearedKeys: string[], errors: string[] }> {
  const normalizedPhone = normalizePhoneNumber(phoneNumber)
  const redisClient = getRedisClient()
  
  const clearedKeys: string[] = []
  const errors: string[] = []
  
  if (!redisClient) {
    return { clearedKeys, errors: ["Redis no disponible"] }
  }
  
  // Lista de todas las keys que debemos limpiar
  // Formato: algunos usan configId:phone, otros usan solo phone
  const keysToDelete = [
    // Con formato configId:phone
    `conv_context:${configId}:${normalizedPhone}`,
    `turn_selection:${configId}:${normalizedPhone}`,
    `reschedule_flow:${configId}:${normalizedPhone}`,
    `post-action:${configId}:${normalizedPhone}`,
    `dni_awaiting:${configId}:${normalizedPhone}`,
    `booking_flow:${configId}:${normalizedPhone}`,
    `appointment_context:${configId}:${normalizedPhone}`,
    `appointment_flow:${configId}:${normalizedPhone}`,
    // Sprint 34: estado de despedida (farewell-handler)
    `farewell:${configId}:${normalizedPhone}`,
    // Sprint 30: persona equivocada (wrong-number-handler)
    `wrong_person:${configId}:${normalizedPhone}`,
    
    // Con formato solo phone (sin configId)
    `patient_detection_state:${normalizedPhone}`,
    `new_patient_flow:${normalizedPhone}`,
    `existing_patient_flow:${normalizedPhone}`,
  ]
  
  // Limpiar cada key
  for (const key of keysToDelete) {
    try {
      const deleted = await redisClient.del(key)
      if (deleted > 0) {
        clearedKeys.push(key)
      }
    } catch (error) {
      const errorMsg = `Error limpiando ${key}: ${(error as Error).message}`
      errors.push(errorMsg)
      console.error(`[DB] ${errorMsg}`)
    }
  }

  return { clearedKeys, errors }
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
  const normalizedIdentifier = normalizePhoneNumber(userIdentifier)
  const key = `${THREAD_PREFIX}${normalizedIdentifier}:${configId}`
  const redisClient = getRedisClient()

  if (redisClient) {
    const threadData = await redisClient.get(key)
    const threadInfo = safeJsonParse(threadData, key)
    if (threadInfo && threadInfo.threadId) {
      return { thread_id: threadInfo.threadId }
    }
    return null
  } else {
    const threadInfo = memoryStorage.threads.get(key)
    if (threadInfo && threadInfo.threadId) {
      return { thread_id: threadInfo.threadId }
    }
    return null
  }
}

export async function setThread(userIdentifier: string, configId: string, threadId: string): Promise<void> {
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
    } else {
      await redisClient.set(key, JSON.stringify(threadInfo))
    }
  } else {
    memoryStorage.threads.set(key, threadInfo)
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

// Función para limpiar el assistantId de un thread (volver al asistente principal)
export async function clearThreadAssistantId(
  phoneNumber: string,
  whatsappConfigId: string,
): Promise<boolean> {
  const normalizedPhone = normalizePhoneNumber(phoneNumber)
  const key = `${THREAD_PREFIX}${normalizedPhone}:${whatsappConfigId}`
  const redisClient = getRedisClient()

  try {
    if (redisClient) {
      const threadData = await redisClient.get(key)
      const threadInfo = safeJsonParse(threadData, key)

      if (threadInfo) {
        if (threadInfo.assistantId) {
          const updatedThreadInfo = {
            ...threadInfo,
            assistantId: undefined,
            lastMessageAt: new Date().toISOString(),
          }
          await redisClient.set(key, JSON.stringify(updatedThreadInfo))
          return true
        } else {
          return false
        }
      } else {
        return false
      }
    } else {
      // Fallback a memoria
      const threadInfo = memoryStorage.threads.get(key)
      if (threadInfo && threadInfo.assistantId) {
        threadInfo.assistantId = undefined
        threadInfo.lastMessageAt = new Date().toISOString()
        memoryStorage.threads.set(key, threadInfo)
        return true
      }
      return false
    }
  } catch (error) {
    console.error(`[DB] Error al limpiar assistantId para ${normalizedPhone}:`, error)
    return false
  }
}

export async function updateThreadId(
  phoneNumber: string,
  whatsappConfigId: string,
  newThreadId: string,
  assistantId?: string,
): Promise<void> {
  const normalizedPhone = normalizePhoneNumber(phoneNumber)
  const key = `${THREAD_PREFIX}${normalizedPhone}:${whatsappConfigId}`
  const redisClient = getRedisClient()

  const threadInfo: ThreadInfo = {
    threadId: newThreadId,
    phoneNumber: normalizedPhone,
    whatsappConfigId,
    lastMessageAt: new Date().toISOString(),
    messageCount: 0,
    createdAt: new Date().toISOString(),
    isResetThread: false,
    assistantId: assistantId,
  }

  if (redisClient) {
    await redisClient.set(key, JSON.stringify(threadInfo))
  } else {
    memoryStorage.threads.set(key, threadInfo)
  }
}

// ==========================================
// GLOBAL TEMPLATES - Plantillas Globales
// ==========================================

const GLOBAL_TEMPLATE_PREFIX = "global_template:"

// Almacenamiento en memoria para plantillas globales
const globalTemplateMemoryStorage = new Map<string, GlobalTemplate>()

// Crear una plantilla global
export async function createGlobalTemplate(template: Omit<GlobalTemplate, "id" | "createdAt" | "updatedAt">): Promise<GlobalTemplate> {
  const id = nanoid()
  const now = new Date().toISOString()

  const newTemplate: GlobalTemplate = {
    ...template,
    id,
    createdAt: now,
    updatedAt: now,
  }

  const redisClient = getRedisClient()

  if (redisClient) {
    await redisClient.set(`${GLOBAL_TEMPLATE_PREFIX}${id}`, JSON.stringify(newTemplate))
  } else {
    globalTemplateMemoryStorage.set(id, newTemplate)
  }

  return newTemplate
}

// Obtener una plantilla global por ID
export async function getGlobalTemplate(id: string): Promise<GlobalTemplate | null> {
  try {
    const redisClient = getRedisClient()

    if (redisClient) {
      const templateData = await redisClient.get(`${GLOBAL_TEMPLATE_PREFIX}${id}`)
      if (!templateData) return null
      return safeJsonParse(templateData)
    } else {
      return globalTemplateMemoryStorage.get(id) || null
    }
  } catch (error) {
    console.error(`[DB] Error al obtener plantilla global ${id}:`, error)
    return null
  }
}

// Obtener todas las plantillas globales
export async function getAllGlobalTemplates(): Promise<GlobalTemplate[]> {
  try {
    const redisClient = getRedisClient()

    if (redisClient) {
      const keys = await scanRedisKeys(redisClient, `${GLOBAL_TEMPLATE_PREFIX}*`)
      if (keys.length === 0) return []

      const templates = await Promise.all(
        keys.map(async (key) => {
          const templateData = await redisClient.get(key)
          return safeJsonParse(templateData)
        }),
      )

      const validTemplates = templates.filter(Boolean) as GlobalTemplate[]
      validTemplates.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      return validTemplates
    } else {
      const templates = Array.from(globalTemplateMemoryStorage.values())
      templates.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      return templates
    }
  } catch (error) {
    console.error(`[DB] Error al obtener plantillas globales:`, error)
    return []
  }
}

// Actualizar una plantilla global
export async function updateGlobalTemplate(
  id: string,
  updates: Partial<Omit<GlobalTemplate, "id" | "createdAt">>,
): Promise<GlobalTemplate | null> {
  try {
    const template = await getGlobalTemplate(id)
    if (!template) return null

    const updatedTemplate: GlobalTemplate = {
      ...template,
      ...updates,
      updatedAt: new Date().toISOString(),
    }

    const redisClient = getRedisClient()

    if (redisClient) {
      await redisClient.set(`${GLOBAL_TEMPLATE_PREFIX}${id}`, JSON.stringify(updatedTemplate))
    } else {
      globalTemplateMemoryStorage.set(id, updatedTemplate)
    }

    return updatedTemplate
  } catch (error) {
    console.error(`[DB] Error al actualizar plantilla global ${id}:`, error)
    return null
  }
}

// Eliminar una plantilla global
export async function deleteGlobalTemplate(id: string): Promise<boolean> {
  try {
    const redisClient = getRedisClient()

    if (redisClient) {
      await redisClient.del(`${GLOBAL_TEMPLATE_PREFIX}${id}`)
    } else {
      globalTemplateMemoryStorage.delete(id)
    }

    return true
  } catch (error) {
    console.error(`[DB] Error al eliminar plantilla global ${id}:`, error)
    return false
  }
}

// Verificar si existe una plantilla global con el mismo nombre
export async function globalTemplateExistsByName(name: string): Promise<boolean> {
  const templates = await getAllGlobalTemplates()
  return templates.some((t) => t.name.toLowerCase() === name.toLowerCase())
}
