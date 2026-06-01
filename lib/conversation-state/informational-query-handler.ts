/**
 * Sprint 16: Handler de Consultas Informativas (SIMPLIFICADO)
 * 
 * CAMBIO IMPORTANTE (31/05):
 * Se DESACTIVAN los regex complejos de consultas informativas y se delega
 * completamente al NLU Fallback Router (Sprint 18) para casos ambiguos.
 * 
 * Solo se mantienen patrones ULTRA-CLAROS para dirección/horario/profesional.
 * Todo lo demás pasa al NLU Fallback que usa GPT-4o-mini.
 * 
 * Problema resuelto:
 * - "Necesito preparación?" NO debe matchear DATE_QUERY
 * - "Esto es importante" NO debe matchear como consulta
 * - Solo regex con HIGH CONFIDENCE se procesan aquí
 */

import { createConversationLogger } from "./logger"
import type { ChatbotData } from "@/types/chatbot"

const logger = createConversationLogger("informational-query")

// ============================================================================
// TIPOS
// ============================================================================

export type InformationalQueryType =
  | "direccion"          // ¿Dónde queda? ¿Cuál es la dirección?
  | "horario"            // ¿A qué hora es? ¿Cuál es el horario?
  | "profesional"        // ¿Con quién es el turno? ¿Quién me atiende?
  | "unknown"            // No detectado por regex

// ============================================================================
// PATRONES ULTRA-CLAROS SOLAMENTE
// ============================================================================

/**
 * SOLO patrones con ALTÍSIMA especificidad
 * Evita falsos positivos como:
 * - "Necesito preparación?" (contiene "es" y "ó" pero no es consulta)
 * - "Esto es importante" (contiene "es" pero no es consulta)
 */
const CLEAR_ADDRESS_PATTERNS = [
  /\b(?:cu[aá]l\s+es\s+)?(?:la\s+)?direcci[oó]n\b/i,           // "cuál es la dirección"
  /\b(?:d[oó]nde\s+(?:queda|est[aá]|es))\b/i,                 // "dónde queda/está"
  /\bme\s+(?:pas[aá]s|pod[eé]s\s+pasar|podes\s+pasar).*direcci[oó]n\b/i, // "me pasas la dirección"
  /\b(?:ubicaci[oó]n|donde)\b/i,                              // "ubicación" / "donde" (palabra aislada)
  /\bc[oó]mo\s+llego\b/i,                                      // "cómo llego"
]

const CLEAR_SCHEDULE_PATTERNS = [
  /\ba\s+qu[eé]\s+hora\s+(?:es|tengo)\b/i,                     // "a qué hora es/tengo"
  /\b(?:cu[aá]l\s+es\s+)?(?:el\s+)?horario\b/i,               // "cuál es el horario"
  /\ba\s+qu[eé]\s+hora\s+(?:debo\s+)?(?:ir|llegar)\b/i,        // "a qué hora debo ir"
  /\b(?:qué\s+)?hora\s+es\b/i,                                 // "qué hora es"
]

const CLEAR_PROFESSIONAL_PATTERNS = [
  /\b(?:con\s+)?qui[eé]n\s+(?:es|tengo)(?:\s+el\s+turno)?\b/i, // "con quién es/tengo"
  /\b(?:qui[eé]n\s+)?(?:me\s+)?atiende\b/i,                    // "quién me atiende"
  /\bme\s+atiende\b/i,                                         // "me atiende"
]

// ============================================================================
// DETECCIÓN POR PATRONES
// ============================================================================

export function detectInformationalQueryType(message: string): InformationalQueryType {
  const cleanMessage = message.trim()

  // SOLO patrones ultra-claros
  if (CLEAR_ADDRESS_PATTERNS.some(p => p.test(cleanMessage))) {
    return "direccion"
  }

  if (CLEAR_SCHEDULE_PATTERNS.some(p => p.test(cleanMessage))) {
    return "horario"
  }

  if (CLEAR_PROFESSIONAL_PATTERNS.some(p => p.test(cleanMessage))) {
    return "profesional"
  }

  return "unknown"
}

export function isInformationalQuery(message: string): boolean {
  return detectInformationalQueryType(message) !== "unknown"
}

// ============================================================================
// RESPUESTAS TEMPLATE
// ============================================================================

export function buildAddressResponse(appointmentData: ChatbotData): string {
  const turno = appointmentData.turno || appointmentData.turnos?.[0]
  
  if (!turno) {
    return "No encontré información del turno. ¿Podrías indicarme con qué turno necesitás ayuda?"
  }
  
  const direccion = turno.direccion || ""
  const sede = turno.sede || appointmentData.clinica || "la clínica"
  
  if (direccion) {
    return `La dirección de ${sede} es:\n\n📍 *${direccion}*\n\n¿Hay algo más en lo que pueda ayudarte?`
  }
  
  return `Tu turno es en *${sede}*. Para la dirección exacta, contactá directamente a la clínica.\n\n¿Hay algo más en lo que pueda ayudarte?`
}

export function buildScheduleResponse(appointmentData: ChatbotData): string {
  const turno = appointmentData.turno || appointmentData.turnos?.[0]
  
  if (!turno) {
    return "No encontré información del turno. ¿Podrías indicarme con qué turno necesitás ayuda?"
  }
  
  const hora = turno.hora_formateada || turno.hora || ""
  const fecha = turno.fecha_formateada || turno.fecha || ""
  
  if (hora) {
    return `Tu turno es a las *${hora}*${fecha ? ` el ${fecha}` : ""}.\n\n¿Hay algo más en lo que pueda ayudarte?`
  }
  
  return "No tengo la información del horario en este momento. ¿Hay algo más en lo que pueda ayudarte?"
}

export function buildProfessionalResponse(appointmentData: ChatbotData): string {
  const turno = appointmentData.turno || appointmentData.turnos?.[0]
  
  if (!turno) {
    return "No encontré información del turno. ¿Podrías indicarme con qué turno necesitás ayuda?"
  }
  
  const profesional = turno.profesional || ""
  
  if (profesional) {
    return `Tu turno es con *${profesional}*.\n\n¿Hay algo más en lo que pueda ayudarte?`
  }
  
  return "No tengo la información del profesional en este momento. ¿Hay algo más en lo que pueda ayudarte?"
}

export function buildInformationalResponse(
  queryType: InformationalQueryType,
  appointmentData: ChatbotData
): string {
  switch (queryType) {
    case "direccion":
      return buildAddressResponse(appointmentData)
    case "horario":
      return buildScheduleResponse(appointmentData)
    case "profesional":
      return buildProfessionalResponse(appointmentData)
    default:
      return "¿En qué puedo ayudarte?"
  }
}

// ============================================================================
// FUNCIÓN PRINCIPAL
// ============================================================================

export interface InformationalQueryResult {
  detected: boolean
  queryType: InformationalQueryType
  response?: string
  confidence?: number
}

/**
 * Detecta consultas informativas ULTRA-CLARAS por regex.
 * 
 * Casos ambiguos (ej: "Necesito preparación?") NO se detectan aquí.
 * Esos casos pasan al NLU Fallback Router (Sprint 18) donde se clasifican
 * con GPT-4o-mini.
 */
export async function detectInformationalQueryPreFlow(
  message: string,
  userPhone: string,
  configId: string,
  appointmentData: ChatbotData | null,
  useNLU: boolean = true
): Promise<InformationalQueryResult> {
  const logger = createConversationLogger(userPhone, configId, "informational-query-preflow")

  // Detectar SOLO patrones ultra-claros
  const queryType = detectInformationalQueryType(message)
  
  if (queryType !== "unknown") {
    logger.info("Consulta informativa CLARA detectada por regex", { 
      queryType,
      message: message.substring(0, 50)
    })
    
    // Si no hay datos del turno, no podemos responder
    if (!appointmentData) {
      logger.info("No hay appointmentData, pasando al flujo normal")
      return { detected: false, queryType: "unknown" }
    }
    
    const response = buildInformationalResponse(queryType, appointmentData)
    return {
      detected: true,
      queryType,
      response,
      confidence: 0.95
    }
  }

  // Todo lo demás pasa al NLU Fallback Router (Sprint 18)
  logger.info("Consulta no detectada por regex, pasará al NLU Fallback")
  return { detected: false, queryType: "unknown" }
}

/**
 * Para compatibilidad backwards
 */
export function mightBeInformationalQuery(message: string): boolean {
  return isInformationalQuery(message)
}

export function setInformationalQueryNLUAssistantId(assistantId: string): void {
  // Ya no es necesario, el NLU Fallback Router maneja todo
}

