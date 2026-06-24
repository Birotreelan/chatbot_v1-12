/**
 * Sprint 14: Detección de Confirmación/Cancelación Directa
 * 
 * Detecta cuando un usuario responde con texto libre ("Confirmo", "Cancelo", etc.)
 * después de recibir un recordatorio de turno (dentro de ventana 24h).
 * 
 * Flujo:
 * 1. Verificar si hay appointmentContext reciente (ventana 24h)
 * 2. Detectar si el mensaje es confirmación o cancelación usando patrones regex
 * 3. Para casos ambiguos, usar NLU
 * 4. Procesar la acción directamente (sin pasar por detección de paciente)
 */

import { createConversationLogger } from "./logger"
import { getRedisClient } from "@/lib/redis"
import { openai } from "@/lib/openai"
import { isWithinTemplateWindow } from "@/lib/appointment-stats"

// ============================================================================
// PATRONES DE CONFIRMACIÓN
// ============================================================================

/**
 * Patrones PUROS de confirmación (alta confianza, 0ms latencia)
 * El usuario está confirmando que asistirá al turno
 */
const PURE_CONFIRMATION_PATTERNS = [
  // Confirmaciones explícitas
  /^\.?confirmo\.?$/i,
  /^\.?confirmado\.?$/i,
  /^\.?confirmar\.?$/i,
  /^\.?si,?\s*confirmo\.?$/i,
  /^\.?ok,?\s*confirmo\.?$/i,
  /^\.?listo,?\s*confirmo\.?$/i,
  /^\.?la\s*confirmo\.?$/i,
  /^\.?lo\s*confirmo\.?$/i,
  
  // Confirmaciones con agradecimiento (caso crítico: "La confirmo. Gracias por avisar")
  /^\.?(?:la\s+)?confirmo\.?\s*[.,!]?\s*(?:muchas?\s+)?gracias.*$/i,
  /^\.?confirmo\.?\s*[.,!]?\s*(?:muchas?\s+)?gracias.*$/i,
  /^\.?confirmado\.?\s*[.,!]?\s*(?:muchas?\s+)?gracias.*$/i,
  /^\.?(?:si,?\s*)?confirmo\.?\s*[.,!]?\s*gracias.*$/i,
  
  // Asistencia
  /^\.?si,?\s*asisto\.?$/i,
  /^\.?asistire\.?$/i,
  /^\.?asistiré\.?$/i,
  /^\.?voy\.?$/i,
  /^\.?si,?\s*voy\.?$/i,
  /^\.?ire\.?$/i,
  /^\.?iré\.?$/i,
  /^\.?ahi\s*estare\.?$/i,
  /^\.?ahí\s*estaré\.?$/i,
  /^\.?ahi\s*voy\.?$/i,
  /^\.?ahí\s*voy\.?$/i,
  
  // Asistencia con agradecimiento
  /^\.?(?:si,?\s*)?voy\.?\s*[.,!]?\s*(?:muchas?\s+)?gracias.*$/i,
  /^\.?(?:ahi|ahí)\s*(?:estare|estaré)\.?\s*[.,!]?\s*(?:muchas?\s+)?gracias.*$/i,
  
  // Afirmaciones simples con contexto de turno
  /^\.?dale\.?$/i,
  /^\.?listo\.?$/i,
  /^\.?ok\.?$/i,
  /^\.?bueno\.?$/i,
  /^\.?perfecto\.?$/i,
  /^\.?de\s*acuerdo\.?$/i,
  /^\.?si\.?$/i,
  /^\.?sí\.?$/i,
  
  // Combinaciones comunes
  /^\.?si,?\s*(?:dale|listo|ok|bueno|perfecto)\.?$/i,
  /^\.?ok,?\s*(?:dale|listo|perfecto)\.?$/i,
  /^\.?dale,?\s*confirmo\.?$/i,
  /^\.?listo,?\s*ahi\s*estare\.?$/i,
]

/**
 * Keywords que podrían indicar confirmación (requiere NLU para casos largos)
 */
const CONFIRMATION_KEYWORDS = [
  "confirmo",
  "confirmado",
  "confirmar",
  "asisto",
  "asistiré",
  "asistire",
  "voy",
  "iré",
  "ire",
  "ahí estaré",
  "ahi estare",
  "de acuerdo",
]

// ============================================================================
// PATRONES DE CANCELACIÓN
// ============================================================================

/**
 * Patrones PUROS de cancelación (alta confianza, 0ms latencia)
 * El usuario está indicando que NO asistirá o quiere cancelar
 */
const PURE_CANCELLATION_PATTERNS = [
  // Cancelaciones explícitas
  /^\.?cancelo\.?$/i,
  /^\.?cancelar\.?$/i,
  /^\.?quiero\s*cancelar\.?$/i,
  /^\.?cancelen\s*(?:el\s*)?(?:turno|cita)\.?$/i,
  /^\.?cancelar\s*(?:el\s*)?(?:turno|cita)\.?$/i,
  
  // No asistencia
  /^\.?no\s*(?:puedo|voy)\.?$/i,
  /^\.?no\s*asistire\.?$/i,
  /^\.?no\s*asistiré\.?$/i,
  /^\.?no\s*ire\.?$/i,
  /^\.?no\s*iré\.?$/i,
  /^\.?no\s*voy\s*a\s*(?:poder|ir)\.?$/i,
  
  // Negaciones simples con contexto
  /^\.?no\.?$/i,
  /^\.?no,?\s*(?:gracias|cancelar)\.?$/i,
]

/**
 * Keywords que podrían indicar cancelación (requiere NLU para casos largos)
 */
const CANCELLATION_KEYWORDS = [
  "cancelo",
  "cancelar",
  "cancelen",
  "no puedo",
  "no voy",
  "no asisto",
  "no asistiré",
  "no iré",
]

// ============================================================================
// FUNCIONES DE DETECCIÓN POR PATRONES
// ============================================================================

/**
 * Detecta si el mensaje es una confirmación PURA usando patrones regex
 */
export function isDirectConfirmationPattern(message: string): boolean {
  const cleanMessage = message.trim()
  return PURE_CONFIRMATION_PATTERNS.some((pattern) => pattern.test(cleanMessage))
}

/**
 * Detecta si el mensaje es una cancelación PURA usando patrones regex
 */
export function isDirectCancellationPattern(message: string): boolean {
  const cleanMessage = message.trim()
  return PURE_CANCELLATION_PATTERNS.some((pattern) => pattern.test(cleanMessage))
}

/**
 * Verifica si el mensaje PODRÍA ser confirmación (contiene keywords)
 */
export function mightBeConfirmation(message: string): boolean {
  const lowerMessage = message.toLowerCase().trim()
  return CONFIRMATION_KEYWORDS.some((keyword) => lowerMessage.includes(keyword))
}

/**
 * Verifica si el mensaje PODRÍA ser cancelación (contiene keywords)
 */
export function mightBeCancellation(message: string): boolean {
  const lowerMessage = message.toLowerCase().trim()
  return CANCELLATION_KEYWORDS.some((keyword) => lowerMessage.includes(keyword))
}

// ============================================================================
// NLU PARA CASOS AMBIGUOS
// ============================================================================

export type DirectActionIntent = 
  | "confirmar_asistencia" 
  | "cancelar_turno" 
  | "consulta_con_cortesia" 
  | "otro"

interface NLUResult {
  intent: DirectActionIntent
  confidence: number
  reasoning: string
}

/**
 * Clasifica la intención del mensaje: confirmación, cancelación o consulta.
 * Híbrido: reglas primero (gratis), GPT-4o-mini solo para casos ambiguos.
 */
export async function classifyDirectActionWithNLU(
  message: string,
  userPhone: string,
  configId: string
): Promise<NLUResult> {
  const logger = createConversationLogger(userPhone, configId, "direct-action-nlu")

  // 1. Reglas determinísticas (sin costo, instantáneo)
  const rulesResult = classifyByRules(message)
  if (rulesResult.confidence >= 0.75) {
    logger.info("Clasificado por reglas", { intent: rulesResult.intent, confidence: rulesResult.confidence })
    return rulesResult
  }

  // 2. Caso ambiguo → GPT-4o-mini Chat Completions (no Assistants)
  logger.info("Caso ambiguo, escalando a GPT-4o-mini", { message: message.substring(0, 50) })

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Clasificá la intención de un mensaje de WhatsApp en el contexto de un chatbot de turnos médicos.

El paciente recibió un recordatorio de turno. Clasificá su respuesta en:
- "confirmar_asistencia": confirma que va a ir al turno (ej: "si estaré", "ahi voy", "voy a ir", "la confirmo", "confirmo", incluso con typos)
- "cancelar_turno": quiere cancelar (ej: "no puedo ir", "cancelo", "no voy a poder", "quiero cancelar")
- "consulta_con_cortesia": pregunta o solicita algo distinto a confirmar/cancelar (ej: "¿puedo cambiar el horario?", "¿cuánto cuesta?")
- "otro": no encaja en ninguna categoría

IMPORTANTE: Aunque haya typos o lenguaje informal, si la intención es clara, clasificar correctamente.

Respondé SOLO con JSON: {"intent": "confirmar_asistencia"|"cancelar_turno"|"consulta_con_cortesia"|"otro", "confidence": 0.0-1.0, "reasoning": "..."}`,
        },
        { role: "user", content: `"${message}"` },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 100,
    })

    const text = response.choices[0]?.message?.content
    if (!text) throw new Error("No response")

    const parsed = JSON.parse(text)
    logger.info("GPT-4o-mini clasificación", { intent: parsed.intent, confidence: parsed.confidence })

    return {
      intent: parsed.intent as DirectActionIntent,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning || "",
    }
  } catch (error) {
    logger.warn("GPT-4o-mini falló, usando resultado de reglas", { error })
    return rulesResult
  }
}

/**
 * Clasificación por reglas como fallback cuando NLU no está disponible
 */
function classifyByRules(message: string): NLUResult {
  const lowerMessage = message.toLowerCase().trim()
  
  // Si es patrón puro de confirmación
  if (isDirectConfirmationPattern(message)) {
    return {
      intent: "confirmar_asistencia",
      confidence: 0.95,
      reasoning: "Coincide con patrón de confirmación pura",
    }
  }
  
  // Si es patrón puro de cancelación
  if (isDirectCancellationPattern(message)) {
    return {
      intent: "cancelar_turno",
      confidence: 0.95,
      reasoning: "Coincide con patrón de cancelación pura",
    }
  }
  
  // Si contiene signos de interrogación, probablemente es consulta
  if (message.includes("?")) {
    return {
      intent: "consulta_con_cortesia",
      confidence: 0.85,
      reasoning: "Contiene signo de interrogación, indica consulta",
    }
  }
  
  // Mensaje corto con keyword de confirmación
  if (message.length < 40 && mightBeConfirmation(message)) {
    return {
      intent: "confirmar_asistencia",
      confidence: 0.75,
      reasoning: "Mensaje corto con keyword de confirmación",
    }
  }
  
  // Mensaje corto con keyword de cancelación
  if (message.length < 40 && mightBeCancellation(message)) {
    return {
      intent: "cancelar_turno",
      confidence: 0.75,
      reasoning: "Mensaje corto con keyword de cancelación",
    }
  }
  
  return {
    intent: "otro",
    confidence: 0.50,
    reasoning: "No se pudo clasificar con certeza",
  }
}

// ============================================================================
// FUNCIÓN PRINCIPAL DE DETECCIÓN PRE-FLUJO
// ============================================================================

export interface DirectActionResult {
  detected: boolean
  action?: "confirm" | "cancel"
  appointmentContext?: Record<string, unknown>
  response?: string
}

/**
 * Detecta si el mensaje es una confirmación/cancelación directa
 * ANTES de iniciar la detección de paciente.
 * 
 * Requisitos para activarse:
 * 1. Debe existir un appointmentContext reciente (ventana 24h)
 * 2. El mensaje debe coincidir con patrones de confirmación/cancelación
 * 
 * @returns DirectActionResult con la acción detectada o detected: false
 */
export async function detectDirectConfirmationPreFlow(
  userPhone: string,
  configId: string,
  clienteId: string,
  message: string,
  useNLU: boolean = true
): Promise<DirectActionResult> {
  const logger = createConversationLogger(userPhone, configId, "direct-confirmation-preflow")
  const redis = getRedisClient()

  // Paso 0: Verificar que estamos dentro de la ventana de 24h del template
  const withinWindow = await isWithinTemplateWindow(clienteId, userPhone)
  if (!withinWindow) {
    logger.info("Fuera de ventana de template, no aplica detección directa")
    return { detected: false }
  }

  // Paso 1: Obtener el appointmentContext de Redis
  const appointmentContext = await getAppointmentContext(userPhone, configId, redis)
  if (!appointmentContext) {
    logger.info("No hay appointmentContext, no aplica detección directa")
    return { detected: false }
  }

  logger.info("Contexto de cita encontrado, verificando patrones", {
    message,
    appointmentId: appointmentContext.appointment_id,
  })

  // Paso 2: Verificar patrones PUROS (0ms latencia)
  if (isDirectConfirmationPattern(message)) {
    logger.info("Confirmación PURA detectada por patrón", { message })
    return {
      detected: true,
      action: "confirm",
      appointmentContext,
    }
  }

  if (isDirectCancellationPattern(message)) {
    logger.info("Cancelación PURA detectada por patrón", { message })
    return {
      detected: true,
      action: "cancel",
      appointmentContext,
    }
  }

  // Paso 3: Si no parece confirmación ni cancelación, salir rápido
  const mightConfirm = mightBeConfirmation(message)
  const mightCancel = mightBeCancellation(message)
  
  if (!mightConfirm && !mightCancel) {
    logger.info("No parece confirmación ni cancelación, continuando flujo normal")
    return { detected: false }
  }

  // Paso 4: Caso ambiguo - usar NLU si está habilitado
  if (useNLU) {
    logger.info("Caso ambiguo, usando NLU", { 
      message,
      mightConfirm,
      mightCancel,
    })
    
    const classification = await classifyDirectActionWithNLU(message, userPhone, configId)
    
    logger.info("Clasificación NLU", {
      intent: classification.intent,
      confidence: classification.confidence,
    })

    if (classification.intent === "confirmar_asistencia" && classification.confidence >= 0.70) {
      return {
        detected: true,
        action: "confirm",
        appointmentContext,
      }
    }

    if (classification.intent === "cancelar_turno" && classification.confidence >= 0.70) {
      return {
        detected: true,
        action: "cancel",
        appointmentContext,
      }
    }

    // consulta_con_cortesia u otro = continuar flujo normal
    return { detected: false }
  }

  // Paso 5: Sin NLU, usar fallback por reglas para casos ambiguos
  const fallback = classifyByRules(message)
  
  if (fallback.intent === "confirmar_asistencia" && fallback.confidence >= 0.75) {
    return {
      detected: true,
      action: "confirm",
      appointmentContext,
    }
  }

  if (fallback.intent === "cancelar_turno" && fallback.confidence >= 0.75) {
    return {
      detected: true,
      action: "cancel",
      appointmentContext,
    }
  }

  return { detected: false }
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Obtiene el appointmentContext de Redis
 */
async function getAppointmentContext(
  userPhone: string,
  configId: string,
  redis: ReturnType<typeof getRedisClient>
): Promise<Record<string, unknown> | null> {
  if (!redis) return null

  try {
    const key = `appointment_context:${configId}:${userPhone}`
    const data = await redis.get(key)
    if (!data) return null

    // Upstash Redis puede devolver el objeto ya parseado o un string
    // dependiendo de como se guardo el dato
    if (typeof data === 'object') {
      return data as Record<string, unknown>
    }
    
    return JSON.parse(data as string)
  } catch (error) {
    console.error("[DIRECT_CONFIRM] Error leyendo appointmentContext:", error)
    return null
  }
}

/**
 * Construye la respuesta de confirmación exitosa
 */
export function buildConfirmationSuccessResponse(patientName: string): string {
  const responses = [
    `¡Perfecto ${patientName}! Tu turno ha sido confirmado. Te esperamos.`,
    `¡Listo ${patientName}! Turno confirmado. ¡Nos vemos!`,
    `¡Excelente ${patientName}! Tu cita está confirmada. Te esperamos.`,
  ]
  return responses[Math.floor(Math.random() * responses.length)]
}

/**
 * Construye la respuesta para iniciar doble confirmación de cancelación
 */
export function buildCancelConfirmationPrompt(
  patientName: string,
  appointmentDetails: string
): string {
  return `${patientName}, entendemos que querés cancelar tu turno:\n\n${appointmentDetails}\n\n¿Confirmás la cancelación?\n\n1- Sí, cancelar el turno\n2- No, mantener el turno`
}

