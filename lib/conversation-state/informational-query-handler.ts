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
  | "paciente"           // ¿Para quién es el turno? ¿A nombre de quién está?
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
  // 8/9/2026 (caso Elsa Silva, tel. 1141898093): el "con" era OPCIONAL —
  // `(?:con\s+)?quién es` — así que "el turno PARA QUIÉN es?" matcheaba acá y se
  // respondía con el nombre del profesional. Son preguntas opuestas: una es por
  // el médico, la otra por el paciente. Ahora el "con" es obligatorio y la
  // pregunta por el paciente tiene sus propios patrones (ver PATIENT_PATTERNS).
  /\bcon\s+qui[eé]n\s+(?:es|tengo)(?:\s+el\s+turno)?\b/i,      // "con quién es/tengo"
  /\bqui[eé]n\s+me\s+atiende\b/i,                              // "quién me atiende"
  /\bme\s+atiende\b/i,                                         // "me atiende"
  /\bqu[eé]\s+(?:m[eé]dico|doctor|profesional)\b/i,            // "qué médico/doctor me toca"
]

/**
 * Pregunta por el TITULAR del turno, no por el profesional.
 *
 * Caso real: el recordatorio no dice a nombre de quién está el turno, así que
 * en un teléfono familiar la pregunta es natural y frecuente. Antes caía en el
 * patrón del profesional y se respondía otra cosa.
 */
const CLEAR_PATIENT_PATTERNS = [
  /\bpara\s+qui[eé]n\s+(?:es|era|ser[ií]a)\b/i,                // "para quién es (el turno)"
  /\bel\s+turno\s+para\s+qui[eé]n\b/i,                         // "el turno para quién es"
  /\ba\s+nombre\s+de\s+qui[eé]n\b/i,                           // "a nombre de quién está"
  /\bde\s+qui[eé]n\s+es\s+(?:el\s+)?turno\b/i,                 // "de quién es el turno"
  /\bqui[eé]n\s+tiene\s+(?:el\s+)?turno\b/i,                   // "quién tiene el turno"
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

  // El paciente se evalúa ANTES que el profesional: "para quién es el turno"
  // contiene "quién es", y si el profesional gana la carrera se responde con el
  // médico una pregunta que era sobre el titular (caso Elsa Silva, 8/9/2026).
  if (CLEAR_PATIENT_PATTERNS.some(p => p.test(cleanMessage))) {
    return "paciente"
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

/**
 * Responde a quién pertenece el turno (8/9/2026, caso Elsa Silva).
 *
 * El recordatorio no incluye el nombre del titular, y en un teléfono usado por
 * varias personas de una familia la pregunta aparece sola. Antes se respondía
 * con el profesional, y cuando la paciente reformuló ("¿para Elsa Silva?") el
 * sistema le contestó que se había equivocado de número.
 *
 * Sobre exponer el nombre: la clínica registró ESTE teléfono como el de contacto
 * de la paciente y ya le mandó a ese número la fecha, la hora, el profesional y
 * la sede. El nombre del titular es un dato menos sensible que los que ya viajan
 * en el recordatorio. Aun así es información de salud: si preferís no darlo
 * completo, alcanza con cambiar `nombreCompleto` por el primer nombre.
 */
export function buildPatientResponse(appointmentData: ChatbotData): string {
  const paciente = (appointmentData as any).paciente
  const nombres = (paciente?.nombres || "").trim()
  const apellido = (paciente?.apellido || "").trim()
  const nombreCompleto = [nombres, apellido].filter(Boolean).join(" ")

  if (!nombreCompleto) {
    return "No tengo el nombre del titular del turno en este momento. Para confirmarlo, comunicate con la clínica.\n\n¿Hay algo más en lo que pueda ayudarte?"
  }

  return `El turno está a nombre de *${nombreCompleto}*.\n\n¿Hay algo más en lo que pueda ayudarte?`
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
    case "paciente":
      return buildPatientResponse(appointmentData)
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

