/**
 * Post-Action Context Manager
 * 
 * Gestiona el contexto de acciones completadas (confirmación, cancelación, reserva)
 * para permitir que consultas posteriores se pasen directamente a OpenAI
 * con el contexto del turno.
 * 
 * TTL: 2 horas
 */

import { getRedisClient } from "@/lib/redis"
import { openai } from "../openai"
import { createConversationLogger } from "./logger"

const POST_ACTION_PREFIX = "post-action:"
const POST_ACTION_TTL = 2 * 60 * 60 // 2 horas

// ID del asistente NLU post-acción creado en OpenAI Platform
const POST_ACTION_NLU_ASSISTANT_ID = "" // Se configurará después de crear el asistente

export type PostActionType = "confirmation" | "cancellation" | "booking" | "reschedule"

export interface PostActionContext {
  timestamp: number
  actionType: PostActionType
  turno: {
    fecha: string
    hora: string
    profesional: string
    profesional_id?: string
    sede: string
    sede_id?: string
    direccion?: string
  }
  paciente: {
    nombres: string
    apellido: string
    dni?: string
    telefono?: string
  }
}

export type PostActionIntent = 
  | "consulta_turno"      // Pregunta sobre el turno recién procesado
  | "nueva_accion"        // Quiere realizar otra acción (reservar, cancelar, etc)
  | "agradecimiento"      // Cierre de conversación
  | "otro"                // No clasificable

export interface PostActionIntentResult {
  intent: PostActionIntent
  confidence: number
  reasoning: string
}

/**
 * Guarda el contexto de una acción completada
 */
export async function savePostActionContext(
  phoneNumber: string,
  configId: string,
  context: PostActionContext
): Promise<void> {
  const logger = createConversationLogger(phoneNumber, configId, "idle")
  
  try {
    const redis = getRedisClient()
    if (!redis) {
      logger.warn("Redis no disponible para guardar contexto post-acción")
      return
    }

    const key = `${POST_ACTION_PREFIX}${configId}:${phoneNumber}`
    await redis.setex(key, POST_ACTION_TTL, JSON.stringify(context))

    logger.info("Contexto post-acción guardado", {
      actionType: context.actionType,
      ttl: POST_ACTION_TTL,
    })
  } catch (error) {
    logger.error("Error guardando contexto post-acción", error as Error)
  }
}

/**
 * Obtiene el contexto post-acción si existe
 */
export async function getPostActionContext(
  phoneNumber: string,
  configId: string
): Promise<PostActionContext | null> {
  const logger = createConversationLogger(phoneNumber, configId, "idle")
  
  try {
    const redis = getRedisClient()
    if (!redis) return null

    const key = `${POST_ACTION_PREFIX}${configId}:${phoneNumber}`
    const data = await redis.get(key)

    if (!data) return null

    const context = JSON.parse(data as string) as PostActionContext
    
    logger.debug("Contexto post-acción recuperado", {
      actionType: context.actionType,
      age: Math.round((Date.now() - context.timestamp) / 1000 / 60) + " min",
    })

    return context
  } catch (error) {
    logger.error("Error obteniendo contexto post-acción", error as Error)
    return null
  }
}

/**
 * Limpia el contexto post-acción
 */
export async function clearPostActionContext(
  phoneNumber: string,
  configId: string
): Promise<void> {
  try {
    const redis = getRedisClient()
    if (!redis) return

    const key = `${POST_ACTION_PREFIX}${configId}:${phoneNumber}`
    await redis.del(key)

    console.debug(`[POST-ACTION] Contexto limpiado para ${phoneNumber}@${configId}`)
  } catch (error) {
    console.error(`[POST-ACTION] Error limpiando contexto:`, error)
  }
}

/**
 * Detecta la intención del mensaje post-acción usando NLU
 */
export async function detectPostActionIntent(
  userMessage: string,
  context: PostActionContext,
  phoneNumber: string,
  configId: string
): Promise<PostActionIntentResult> {
  const logger = createConversationLogger(phoneNumber, configId, "idle")
  
  // Si no hay asistente configurado, usar fallback
  if (!POST_ACTION_NLU_ASSISTANT_ID) {
    logger.debug("Asistente NLU post-acción no configurado, usando fallback")
    return detectIntentFallback(userMessage)
  }

  try {
    // Crear thread para la conversación
    const thread = await openai.beta.threads.create()
    
    logger.debug("Thread creado para NLU post-acción", { threadId: thread.id })

    // Agregar el mensaje del usuario al thread
    const userPrompt = buildNLUPrompt(userMessage, context)
    
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: userPrompt,
    })

    // Ejecutar el asistente
    const run = await openai.beta.threads.runs.createAndPoll(thread.id, {
      assistant_id: POST_ACTION_NLU_ASSISTANT_ID,
    })

    logger.debug("Run completado", { runStatus: run.status })

    if (run.status !== "completed") {
      logger.error("Run no completado", { status: run.status })
      return detectIntentFallback(userMessage)
    }

    // Obtener los mensajes del thread
    const messages = await openai.beta.threads.messages.list(thread.id)
    
    const assistantMessage = messages.data
      .filter((msg) => msg.role === "assistant")
      .at(0)

    if (!assistantMessage) {
      logger.error("No se encontró mensaje del asistente")
      return detectIntentFallback(userMessage)
    }

    const responseContent = assistantMessage.content[0]
    if (responseContent.type !== "text") {
      logger.error("Respuesta del asistente no es texto")
      return detectIntentFallback(userMessage)
    }

    const responseText = responseContent.text.value

    // Parsear JSON
    let cleanJson = responseText.trim()
    if (cleanJson.startsWith("```")) {
      cleanJson = cleanJson.replace(/```json?\n?/g, "").replace(/```/g, "").trim()
    }

    const parsed = JSON.parse(cleanJson)

    return {
      intent: parsed.intent as PostActionIntent,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
    }
  } catch (error) {
    logger.error("Error en detectPostActionIntent", error as Error)
    return detectIntentFallback(userMessage)
  }
}

/**
 * Construye el prompt para el NLU
 */
function buildNLUPrompt(userMessage: string, context: PostActionContext): string {
  const actionLabel = {
    confirmation: "confirmó",
    cancellation: "canceló", 
    booking: "reservó",
    reschedule: "reagendó",
  }[context.actionType]

  return `## Contexto
El paciente ${context.paciente.nombres} ${actionLabel} su turno hace ${Math.round((Date.now() - context.timestamp) / 1000 / 60)} minutos.

Turno:
- Fecha: ${context.turno.fecha}
- Hora: ${context.turno.hora}
- Profesional: ${context.turno.profesional}
- Sede: ${context.turno.sede}

## Mensaje del paciente
"${userMessage}"

## Clasificar intención`
}

/**
 * Fallback para detección de intención sin NLU
 * Usa reglas simples basadas en palabras clave
 */
function detectIntentFallback(userMessage: string): PostActionIntentResult {
  const msg = userMessage.toLowerCase().trim()

  // Patrones de agradecimiento/despedida
  const gratitudePatterns = [
    /^gracias/,
    /^muchas gracias/,
    /^ok$/,
    /^bueno$/,
    /^perfecto/,
    /^genial/,
    /^chau/,
    /^hasta luego/,
    /^nos vemos/,
    /^listo/,
  ]

  for (const pattern of gratitudePatterns) {
    if (pattern.test(msg)) {
      return {
        intent: "agradecimiento",
        confidence: 0.8,
        reasoning: "Detectado patrón de agradecimiento/despedida",
      }
    }
  }

  // Patrones de nueva acción
  const actionPatterns = [
    /quiero (otro|un|reservar|cancelar|nuevo)/,
    /necesito (otro|un|turno|reservar)/,
    /puedo (reservar|agendar|sacar)/,
    /cancelar/,
    /reagendar/,
    /otro turno/,
  ]

  for (const pattern of actionPatterns) {
    if (pattern.test(msg)) {
      return {
        intent: "nueva_accion",
        confidence: 0.7,
        reasoning: "Detectado patrón de solicitud de nueva acción",
      }
    }
  }

  // Por defecto, asumir consulta sobre el turno
  return {
    intent: "consulta_turno",
    confidence: 0.6,
    reasoning: "No se detectó patrón específico, asumiendo consulta sobre turno",
  }
}

/**
 * Formatea el contexto del turno para pasarlo a OpenAI
 */
export function formatPostActionContextForOpenAI(context: PostActionContext): string {
  const actionLabel = {
    confirmation: "CONFIRMADO",
    cancellation: "CANCELADO", 
    booking: "RESERVADO",
    reschedule: "REAGENDADO",
  }[context.actionType]

  return `[CONTEXTO_POST_ACCION]
Acción_Reciente: ${actionLabel}
Tiempo_Transcurrido: ${Math.round((Date.now() - context.timestamp) / 1000 / 60)} minutos
Paciente: ${context.paciente.nombres} ${context.paciente.apellido}
Turno_Fecha: ${context.turno.fecha}
Turno_Hora: ${context.turno.hora}
Turno_Profesional: ${context.turno.profesional}
Turno_Sede: ${context.turno.sede}
${context.turno.direccion ? `Turno_Direccion: ${context.turno.direccion}` : ""}
[/CONTEXTO_POST_ACCION]

El paciente acaba de completar una acción sobre su turno. Responde a su consulta en el contexto de este turno específico.`
}
