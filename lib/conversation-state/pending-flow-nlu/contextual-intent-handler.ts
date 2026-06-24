/**
 * Contextual Intent Handler para flujos pendientes
 *
 * Analiza el mensaje del usuario cuando está en medio de un flujo (ej: confirmación
 * de cancelación) y responde con texto libre en lugar de las opciones esperadas.
 *
 * Implementación: clasificador determinístico de regex/keyword — sin llamadas a OpenAI.
 * El NLU entiende AMBAS cosas:
 *   1. La intención del usuario (qué quiere hacer)
 *   2. El contexto del flujo actual (qué acción está pendiente)
 *
 * Y genera respuestas que reconocen la intención pero guían al usuario a completar
 * el flujo actual.
 */

import { createConversationLogger } from "../logger"
import type { ChatbotData, ChatbotDataTurno } from "../../appointment-flow-state"
import type { FlowState } from "../../appointment-flow-state"
import { buildContextualResponseTemplates, type PendingFlowType } from "./response-templates"

// ============================================================================
// TIPOS
// ============================================================================

export type DetectedIntent =
  | "solicitar_turno"      // Usuario quiere agendar un nuevo turno
  | "cancelar_turno"       // Usuario quiere cancelar (puede ser confirmación implícita)
  | "confirmar_turno"      // Usuario quiere confirmar asistencia
  | "reagendar"            // Usuario quiere cambiar fecha/hora
  | "consulta_info"        // Pregunta sobre horarios, ubicación, etc
  | "confirmar_accion"     // Acepta la acción pendiente (sí, dale, ok)
  | "rechazar_accion"      // Rechaza la acción pendiente (no, mejor no)
  | "saludo"               // Saludo genérico
  | "despedida"            // Despedida
  | "queja_frustracion"    // Usuario frustrado o quejándose
  | "otro"                 // No se pudo clasificar

export interface ContextualIntentResult {
  detectedIntent: DetectedIntent
  confidence: number
  reasoning: string

  // La acción que debe tomar el sistema
  action:
    | "maintain_flow_with_response"  // Mantener flujo actual, enviar respuesta contextual
    | "process_as_confirmation"      // Tratar como confirmación (1)
    | "process_as_rejection"         // Tratar como rechazo (2)
    | "abandon_flow"                 // Abandonar flujo (baja confianza, error, etc)

  // Respuesta contextual generada (solo si action = "maintain_flow_with_response")
  contextualResponse?: string
}

interface FlowContext {
  flowType: PendingFlowType
  turno: ChatbotDataTurno | null
  turnoIndex: number
  patientName: string
  options: string[]
}

// ============================================================================
// NORMALIZACIÓN
// ============================================================================

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quitar tildes
    .trim()
}

// ============================================================================
// PATTERNS
// ============================================================================

// Afirmación: sí / dale / ok / claro / etc.
const RE_YES =
  /\b(si|dale|ok|okay|claro|bueno|listo|obvio|por supuesto|adelante|procede|afirmo|acepto|correcto|exacto|confirmado|confirmo|sip|sep|si por favor|yes|yep|q si|que si)\b/

// Negación: no / mejor no / etc.
const RE_NO =
  /\b(no|nope|para nada|mejor no|no quiero|no gracias|prefiero no|de ninguna manera|jamas|olvida|olvidalo|no por favor|claro que no)\b/

// Despedida
const RE_FAREWELL =
  /\b(chau|chao|adios|hasta luego|bye|hasta pronto|nos vemos|me voy|buenas noches)\b/

// Cancelar turno
const RE_CANCEL =
  /\b(cancelo|cancelar|tengo que cancelar|quiero cancelar|no puedo (ir|asistir|concurrir)|no voy|no ire|no asistire|baja el turno)\b/

// Reagendar
const RE_RESCHEDULE =
  /\b(reagend|cambiar (la )?(fecha|turno|horario)|otra fecha|otro horario|distinto horario|mover (el )?turno|postergar|adelantar|cambio de (fecha|horario))\b/

// Solicitar turno nuevo
const RE_BOOK =
  /\b(turno nuevo|nuevo turno|pedir (un )?turno|sacar (un )?turno|reservar|quiero (un )?turno|necesito (un )?turno|agendar)\b/

// Confirmar asistencia (diferente de confirmar_accion)
const RE_CONFIRM_ATTEND =
  /\b(confirmar( (asistencia|turno))?|confirmo (asistencia|turno)|voy a ir|ahi estare|ahi voy|asistiré|asistire|estare ahi|alla estare)\b/

// Consulta informativa sobre el turno
const RE_INFO =
  /\b(horario|direccion|donde queda|como llego|ubicacion|telefono|a que hora|con quien|que dia|cual es la (sede|direccion)|cuanto falta)\b/

// Saludo
const RE_GREETING =
  /^(hola|buenas|buenos dias|buenas tardes|buen dia|saludos|hey|hi)\b/

// Queja / frustración
const RE_COMPLAINT =
  /\b(no entiendo|molest|enojad|frustrad|bronca|hart(o|a)|cansad(o|a)|nunca (funcionan|atienden)|siempre igual|nadie atiende|no funciona|un desastre)\b/

// ============================================================================
// CLASIFICADOR DETERMINÍSTICO
// ============================================================================

function extractIntentWithRules(
  userMessage: string,
  context: FlowContext,
): { intent: DetectedIntent; confidence: number; reasoning: string } {
  const msg = normalizeText(userMessage)

  // --- Despedida → abandonar flujo ---
  if (RE_FAREWELL.test(msg)) {
    return { intent: "despedida", confidence: 0.85, reasoning: "Despedida detectada" }
  }

  // --- Flujo de confirmación de cancelación ---
  if (context.flowType === "awaiting_cancel_confirmation") {
    // "cancelar" es afirmación en este flujo
    if (RE_CANCEL.test(msg)) {
      return { intent: "confirmar_accion", confidence: 0.85, reasoning: "Intención de cancelar en flujo de cancelación → confirmar acción" }
    }
    if (RE_YES.test(msg) && !RE_NO.test(msg)) {
      return { intent: "confirmar_accion", confidence: 0.85, reasoning: "Afirmación en flujo de cancelación" }
    }
    if (RE_NO.test(msg)) {
      return { intent: "rechazar_accion", confidence: 0.85, reasoning: "Negación en flujo de cancelación" }
    }
  }

  // --- Flujo de elección de reagendamiento ---
  if (context.flowType === "awaiting_reschedule_choice") {
    // "reagendar" o "turno nuevo" = afirmación (opción 1)
    if (RE_RESCHEDULE.test(msg) || RE_BOOK.test(msg)) {
      return { intent: "confirmar_accion", confidence: 0.85, reasoning: "Intención de reagendar en flujo de reagendamiento → confirmar acción" }
    }
    if (RE_YES.test(msg) && !RE_NO.test(msg)) {
      return { intent: "confirmar_accion", confidence: 0.85, reasoning: "Afirmación en flujo de reagendamiento" }
    }
    if (RE_NO.test(msg)) {
      return { intent: "rechazar_accion", confidence: 0.85, reasoning: "Negación en flujo de reagendamiento" }
    }
  }

  // --- Clasificación general ---

  if (RE_YES.test(msg) && !RE_NO.test(msg)) {
    return { intent: "confirmar_accion", confidence: 0.8, reasoning: "Afirmación genérica" }
  }

  if (RE_NO.test(msg) && !RE_YES.test(msg)) {
    return { intent: "rechazar_accion", confidence: 0.8, reasoning: "Negación genérica" }
  }

  if (RE_CANCEL.test(msg)) {
    return { intent: "cancelar_turno", confidence: 0.8, reasoning: "Intención de cancelación" }
  }

  if (RE_RESCHEDULE.test(msg)) {
    return { intent: "reagendar", confidence: 0.8, reasoning: "Intención de reagendamiento" }
  }

  if (RE_BOOK.test(msg)) {
    return { intent: "solicitar_turno", confidence: 0.75, reasoning: "Solicitud de nuevo turno" }
  }

  if (RE_CONFIRM_ATTEND.test(msg)) {
    return { intent: "confirmar_turno", confidence: 0.75, reasoning: "Confirmación de asistencia al turno" }
  }

  if (RE_INFO.test(msg)) {
    return { intent: "consulta_info", confidence: 0.7, reasoning: "Consulta informativa sobre el turno" }
  }

  if (RE_GREETING.test(msg)) {
    return { intent: "saludo", confidence: 0.75, reasoning: "Saludo detectado" }
  }

  if (RE_COMPLAINT.test(msg)) {
    return { intent: "queja_frustracion", confidence: 0.7, reasoning: "Queja o frustración detectada" }
  }

  return { intent: "otro", confidence: 0.3, reasoning: "No se pudo clasificar el mensaje" }
}

// ============================================================================
// FUNCIÓN PRINCIPAL
// ============================================================================

/**
 * Analiza un mensaje de texto libre cuando el usuario está en un flujo pendiente
 * y genera una respuesta contextual que reconoce la intención pero mantiene el flujo.
 */
export async function handleContextualIntent(
  userMessage: string,
  flowState: FlowState,
  chatbotData: ChatbotData,
  phoneNumber: string,
  configId: string
): Promise<ContextualIntentResult> {
  const logger = createConversationLogger(phoneNumber, configId, "contextual_nlu")

  try {
    logger.info("Analizando intención contextual (reglas)", {
      userMessage: userMessage.substring(0, 50),
      flowType: flowState.type,
    })

    const turnoIndex = flowState.turnoIndex || 0
    const turno = chatbotData.turnos?.[turnoIndex] || null
    const flowType = flowState.type as PendingFlowType

    const context: FlowContext = {
      flowType,
      turno,
      turnoIndex,
      patientName: formatPatientName(chatbotData),
      options: getFlowOptions(flowType),
    }

    const intentResult = extractIntentWithRules(userMessage, context)

    logger.info("Intención clasificada", {
      intent: intentResult.intent,
      confidence: intentResult.confidence,
    })

    const result = determineAction(intentResult, context, chatbotData)

    logger.info("Acción determinada", {
      action: result.action,
      hasResponse: !!result.contextualResponse,
    })

    return result

  } catch (error) {
    logger.error("Error en handleContextualIntent", error as Error)
    return {
      detectedIntent: "otro",
      confidence: 0,
      reasoning: "Error interno",
      action: "abandon_flow",
    }
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function determineAction(
  intentResult: { intent: DetectedIntent; confidence: number; reasoning: string },
  context: FlowContext,
  chatbotData: ChatbotData
): ContextualIntentResult {
  const { intent, confidence, reasoning } = intentResult

  if (intent === "confirmar_accion" && confidence >= 0.7) {
    return { detectedIntent: intent, confidence, reasoning, action: "process_as_confirmation" }
  }

  if (intent === "rechazar_accion" && confidence >= 0.7) {
    return { detectedIntent: intent, confidence, reasoning, action: "process_as_rejection" }
  }

  // Cancelar en flujo de cancelación → confirmar
  if (intent === "cancelar_turno" && context.flowType === "awaiting_cancel_confirmation" && confidence >= 0.6) {
    return {
      detectedIntent: intent,
      confidence,
      reasoning: "Usuario menciona cancelar mientras está en flujo de cancelación",
      action: "process_as_confirmation",
    }
  }

  // Despedida → abandonar flujo
  if (intent === "despedida" && confidence >= 0.7) {
    return { detectedIntent: intent, confidence, reasoning, action: "abandon_flow" }
  }

  // Cambios de intención → mantener flujo con respuesta contextual
  if (["solicitar_turno", "reagendar", "confirmar_turno", "consulta_info", "saludo", "queja_frustracion"].includes(intent)) {
    const templates = buildContextualResponseTemplates(context.flowType)
    const contextualResponse = templates.buildResponse(intent, chatbotData, context.turnoIndex)
    return { detectedIntent: intent, confidence, reasoning, action: "maintain_flow_with_response", contextualResponse }
  }

  // Confianza baja o no clasificable → abandonar flujo
  if (confidence < 0.5 || intent === "otro") {
    return { detectedIntent: intent, confidence, reasoning, action: "abandon_flow" }
  }

  // Default: mantener flujo con respuesta genérica
  const templates = buildContextualResponseTemplates(context.flowType)
  return {
    detectedIntent: intent,
    confidence,
    reasoning,
    action: "maintain_flow_with_response",
    contextualResponse: templates.buildResponse("otro", chatbotData, context.turnoIndex),
  }
}

function getFlowOptions(flowType: PendingFlowType): string[] {
  const options: Record<PendingFlowType, string[]> = {
    awaiting_cancel_confirmation: ["1- Sí, cancelar el turno", "2- No, mantener el turno"],
    awaiting_reschedule_choice: ["1- Reagendar el turno", "2- No quiero reagendar"],
  }
  return options[flowType] || []
}

function formatPatientName(chatbotData: ChatbotData): string {
  const nombres = chatbotData.paciente?.nombres || ""
  const primerNombre = nombres.split(" ")[0]
  return primerNombre.charAt(0).toUpperCase() + primerNombre.slice(1).toLowerCase()
}
