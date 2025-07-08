import { Redis } from "@upstash/redis"
import type { WhatsAppConfig } from "./types"

// Cliente Redis
let redis: Redis | null = null

function getRedisClient() {
  if (redis) return redis
  try {
    redis = Redis.fromEnv()
    return redis
  } catch (error) {
    console.warn("[SYSTEM-PROMPTS] Redis no disponible, usando memoria")
    return null
  }
}

// Almacenamiento en memoria como fallback
const memoryStorage = {
  clientPrompts: new Map<string, ClientPromptConfig>(),
}

// Interfaces
export interface ClientPromptConfig {
  clienteId: string
  companyName: string
  businessType: string
  customInstructions: string
  whatsappSpecific?: string
  widgetSpecific?: string
  active: boolean
  createdAt: string
  updatedAt: string
}

// PROMPT BASE GLOBAL - Funcionalidades core del sistema
const BASE_SYSTEM_PROMPT = `
Eres un asistente virtual especializado en gestión de turnos médicos.

FUNCIONALIDADES PRINCIPALES:
- Validación de DNI de pacientes
- Búsqueda de turnos disponibles
- Reserva de turnos médicos
- Consulta de profesionales y especialidades
- Gestión de datos de pacientes

FLUJO ESTÁNDAR DE RESERVA:
1. Validar DNI del paciente
2. Si es paciente nuevo, solicitar datos completos (nombre, apellido, teléfono, email)
3. Consultar disponibilidad según preferencias
4. Mostrar opciones de turnos disponibles
5. Confirmar reserva con todos los datos

REGLAS GENERALES:
- Siempre confirma la información antes de proceder
- Mantén un registro de los datos del paciente durante la conversación
- Si hay errores, explica claramente qué se necesita
- Proporciona información clara sobre fechas, horarios y profesionales
`.trim()

// PROMPTS ESPECÍFICOS POR CANAL
const CHANNEL_PROMPTS = {
  whatsapp: `
ADAPTACIÓN PARA WHATSAPP:
- Usa un tono conversacional y cercano
- Mantén los mensajes concisos (máximo 2-3 líneas por respuesta)
- Usa emojis ocasionalmente para hacer la conversación más amigable
- Responde rápidamente a cada consulta
- Si necesitas información, pregunta de a una cosa por vez
- Usa "vos" en lugar de "usted" para ser más cercano
- Confirma cada paso del proceso

FORMATO DE RESPUESTAS:
- Saluda de manera amigable
- Sé directo y claro
- Usa listas numeradas para opciones múltiples
- Termina con una pregunta o acción clara
`.trim(),

  widget: `
ADAPTACIÓN PARA WIDGET WEB:
- Usa un tono profesional pero amigable
- Puedes usar respuestas más largas y detalladas
- Estructura la información de manera clara con párrafos
- Usa "usted" para mantener formalidad
- Proporciona información completa en cada respuesta
- Incluye instrucciones paso a paso cuando sea necesario

FORMATO DE RESPUESTAS:
- Saluda profesionalmente
- Organiza la información en secciones claras
- Usa viñetas para listas
- Proporciona contexto adicional cuando sea útil
`.trim(),
}

// Función para construir el prompt completo
export async function buildSystemPrompt(
  clienteId: string,
  channel: "whatsapp" | "widget" = "whatsapp",
): Promise<string> {
  console.log(`[SYSTEM-PROMPTS] Construyendo prompt para cliente ${clienteId}, canal: ${channel}`)

  try {
    // 1. Obtener configuración personalizada del cliente
    const clientConfig = await getClientPromptConfig(clienteId)

    // 2. Construir el prompt en capas
    let systemPrompt = BASE_SYSTEM_PROMPT

    // 3. Agregar adaptación por canal
    systemPrompt += "\n\n" + CHANNEL_PROMPTS[channel]

    // 4. Agregar personalización del cliente si existe
    if (clientConfig) {
      systemPrompt += "\n\n" + buildClientSpecificPrompt(clientConfig, channel)
    }

    console.log(`[SYSTEM-PROMPTS] Prompt construido exitosamente (${systemPrompt.length} caracteres)`)
    return systemPrompt
  } catch (error) {
    console.error(`[SYSTEM-PROMPTS] Error construyendo prompt:`, error)
    // Fallback al prompt base + canal
    return BASE_SYSTEM_PROMPT + "\n\n" + CHANNEL_PROMPTS[channel]
  }
}

// Función para construir la parte específica del cliente
function buildClientSpecificPrompt(config: ClientPromptConfig, channel: "whatsapp" | "widget"): string {
  let clientPrompt = `
PERSONALIZACIÓN PARA ${config.companyName.toUpperCase()}:

INFORMACIÓN DE LA EMPRESA:
- Nombre: ${config.companyName}
- Tipo de negocio: ${config.businessType}

INSTRUCCIONES ESPECÍFICAS:
${config.customInstructions}
`.trim()

  // Agregar instrucciones específicas por canal si existen
  if (channel === "whatsapp" && config.whatsappSpecific) {
    clientPrompt += `\n\nINSTRUCCIONES ESPECÍFICAS PARA WHATSAPP:\n${config.whatsappSpecific}`
  }

  if (channel === "widget" && config.widgetSpecific) {
    clientPrompt += `\n\nINSTRUCCIONES ESPECÍFICAS PARA WIDGET:\n${config.widgetSpecific}`
  }

  return clientPrompt
}

// CRUD para configuraciones de cliente
export async function createClientPromptConfig(
  config: Omit<ClientPromptConfig, "createdAt" | "updatedAt">,
): Promise<ClientPromptConfig> {
  const now = new Date().toISOString()
  const fullConfig: ClientPromptConfig = {
    ...config,
    createdAt: now,
    updatedAt: now,
  }

  const redisClient = getRedisClient()
  const key = `client_prompt:${config.clienteId}`

  if (redisClient) {
    await redisClient.set(key, JSON.stringify(fullConfig))
  } else {
    memoryStorage.clientPrompts.set(config.clienteId, fullConfig)
  }

  console.log(`[SYSTEM-PROMPTS] Configuración creada para cliente: ${config.clienteId}`)
  return fullConfig
}

export async function getClientPromptConfig(clienteId: string): Promise<ClientPromptConfig | null> {
  const redisClient = getRedisClient()
  const key = `client_prompt:${clienteId}`

  try {
    if (redisClient) {
      const data = await redisClient.get(key)
      if (data) {
        return typeof data === "string" ? JSON.parse(data) : data
      }
    } else {
      return memoryStorage.clientPrompts.get(clienteId) || null
    }
  } catch (error) {
    console.error(`[SYSTEM-PROMPTS] Error obteniendo config del cliente ${clienteId}:`, error)
  }

  return null
}

export async function updateClientPromptConfig(
  clienteId: string,
  updates: Partial<Omit<ClientPromptConfig, "clienteId" | "createdAt" | "updatedAt">>,
): Promise<ClientPromptConfig | null> {
  const existing = await getClientPromptConfig(clienteId)
  if (!existing) return null

  const updated: ClientPromptConfig = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  }

  const redisClient = getRedisClient()
  const key = `client_prompt:${clienteId}`

  if (redisClient) {
    await redisClient.set(key, JSON.stringify(updated))
  } else {
    memoryStorage.clientPrompts.set(clienteId, updated)
  }

  console.log(`[SYSTEM-PROMPTS] Configuración actualizada para cliente: ${clienteId}`)
  return updated
}

export async function deleteClientPromptConfig(clienteId: string): Promise<boolean> {
  const redisClient = getRedisClient()
  const key = `client_prompt:${clienteId}`

  try {
    if (redisClient) {
      await redisClient.del(key)
    } else {
      memoryStorage.clientPrompts.delete(clienteId)
    }
    console.log(`[SYSTEM-PROMPTS] Configuración eliminada para cliente: ${clienteId}`)
    return true
  } catch (error) {
    console.error(`[SYSTEM-PROMPTS] Error eliminando config del cliente ${clienteId}:`, error)
    return false
  }
}

export async function getAllClientPromptConfigs(): Promise<ClientPromptConfig[]> {
  const redisClient = getRedisClient()

  try {
    if (redisClient) {
      const keys = await redisClient.keys("client_prompt:*")
      if (keys.length === 0) return []

      const configs = await Promise.all(
        keys.map(async (key) => {
          const data = await redisClient.get(key)
          return typeof data === "string" ? JSON.parse(data) : data
        }),
      )

      return configs.filter(Boolean) as ClientPromptConfig[]
    } else {
      return Array.from(memoryStorage.clientPrompts.values())
    }
  } catch (error) {
    console.error(`[SYSTEM-PROMPTS] Error obteniendo todas las configuraciones:`, error)
    return []
  }
}

// Función de conveniencia para obtener prompt desde WhatsAppConfig
export async function getSystemPromptForConfig(
  config: WhatsAppConfig,
  channel: "whatsapp" | "widget" = "whatsapp",
): Promise<string> {
  if (!config.cliente_id) {
    console.warn(`[SYSTEM-PROMPTS] No hay cliente_id para config ${config.id}, usando prompt base`)
    return BASE_SYSTEM_PROMPT + "\n\n" + CHANNEL_PROMPTS[channel]
  }

  return buildSystemPrompt(config.cliente_id, channel)
}

// Función para previsualizar el prompt completo
export async function previewSystemPrompt(
  clienteId: string,
  channel: "whatsapp" | "widget" = "whatsapp",
): Promise<{
  basePrompt: string
  channelPrompt: string
  clientPrompt: string
  fullPrompt: string
}> {
  const clientConfig = await getClientPromptConfig(clienteId)
  const clientPrompt = clientConfig ? buildClientSpecificPrompt(clientConfig, channel) : ""
  const fullPrompt = await buildSystemPrompt(clienteId, channel)

  return {
    basePrompt: BASE_SYSTEM_PROMPT,
    channelPrompt: CHANNEL_PROMPTS[channel],
    clientPrompt,
    fullPrompt,
  }
}
