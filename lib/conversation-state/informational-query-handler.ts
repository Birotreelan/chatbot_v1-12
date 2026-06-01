/**
 * Sprint 16: Handler de Consultas Informativas
 * 
 * Detecta cuando un usuario pregunta por información general (dirección, horarios, precios, etc.)
 * después de recibir un recordatorio de turno (dentro de ventana 24h) o cuando ya confirmó/interactuó.
 * 
 * Problema que resuelve:
 * - Usuario recibe recordatorio de turno
 * - Usuario confirma el turno
 * - Usuario pregunta "Me podes pasar la direccion"
 * - SIN ESTE HANDLER: El sistema reinicia el flujo de bienvenida (comportamiento incorrecto)
 * - CON ESTE HANDLER: El sistema responde directamente con la dirección del turno
 * 
 * Flujo:
 * 1. Detectar si el mensaje es una consulta informativa usando patrones regex
 * 2. Verificar si hay appointmentContext (turno activo)
 * 3. Responder directamente con la información solicitada del turno
 * 4. Para casos ambiguos, usar NLU
 */

import { createConversationLogger } from "./logger"
import { getRedisClient } from "@/lib/redis"
import { openai } from "@/lib/openai"
import type { ChatbotData } from "@/types/chatbot"

// ID del asistente NLU para consultas informativas
// Configurado con el system prompt: route_to_informational_query_nlu.md
const INFORMATIONAL_QUERY_NLU_ASSISTANT_ID = "asst_JqLw8QNP5PZT6WtGdFMj4Xxe"

// ============================================================================
// TIPOS DE CONSULTAS INFORMATIVAS
// ============================================================================

export type InformationalQueryType =
  | "direccion"          // ¿Dónde queda? ¿Cuál es la dirección?
  | "horario"            // ¿A qué hora es? ¿Cuál es el horario?
  | "profesional"        // ¿Con quién es el turno? ¿Quién me atiende?
  | "fecha"              // ¿Qué día es? ¿Cuándo es?
  | "sede"               // ¿En qué sede? ¿En qué sucursal?
  | "general"            // Información general del turno
  | "unknown"            // No es consulta informativa

// ============================================================================
// PATRONES DE CONSULTAS INFORMATIVAS
// ============================================================================

/**
 * Patrones de consulta de DIRECCIÓN
 */
const ADDRESS_QUERY_PATTERNS = [
  // Preguntas directas
  /(?:cu[aá]l\s+es\s+)?(?:la\s+)?direcci[oó]n/i,
  /(?:d[oó]nde\s+(?:queda|est[aá]|es))/i,
  /(?:me\s+)?(?:pas[aá]s|pod[eé]s\s+pasar|podes\s+pasar)(?:\s+la)?\s+direcci[oó]n/i,
  /(?:me\s+)?(?:dec[ií]s|pod[eé]s\s+decir|podes\s+decir)(?:\s+la)?\s+direcci[oó]n/i,
  /(?:cu[aá]l\s+)?(?:es\s+)?(?:la\s+)?ubicaci[oó]n/i,
  /c[oó]mo\s+llego/i,
  /para\s+(?:ir|llegar)/i,
  /(?:en\s+)?qu[eé]\s+calle/i,
  /(?:la\s+)?direcci[oó]n\s+(?:del\s+)?(?:consultorio|lugar|clinica|cl[ií]nica)/i,
]

/**
 * Patrones de consulta de HORARIO
 */
const SCHEDULE_QUERY_PATTERNS = [
  /(?:a\s+)?qu[eé]\s+hora\s+(?:es|tengo)/i,
  /(?:cu[aá]l\s+es\s+)?(?:el\s+)?horario/i,
  /(?:a\s+)?qu[eé]\s+hora\s+(?:debo\s+)?(?:ir|llegar|estar)/i,
  /(?:me\s+)?(?:pod[eé]s|podes)\s+(?:decir|pasar)\s+(?:la|el)\s+hora/i,
]

/**
 * Patrones de consulta de PROFESIONAL
 */
const PROFESSIONAL_QUERY_PATTERNS = [
  /(?:con\s+)?qui[eé]n\s+(?:es|tengo)(?:\s+el\s+turno)?/i,
  /(?:qui[eé]n\s+)?(?:me\s+)?(?:atiende|va\s+a\s+atender)/i,
  /(?:cu[aá]l\s+es\s+)?(?:el\s+)?(?:nombre\s+)?(?:del\s+)?(?:doctor|doctora|m[eé]dico|m[eé]dica|profesional)/i,
  /(?:con\s+)?qu[eé]\s+(?:doctor|doctora|m[eé]dico|profesional)/i,
]

/**
 * Patrones de consulta de FECHA
 * IMPORTANTE: 
 * - Usar \b word boundaries para evitar "Necesito" matcheando "es"
 * - Patrón 1: Si "cuándo" está presente, es clara consulta de fecha
 *   Si "cuándo" NO está, requiere contexto de cita (turno, hoy, mañana, etc)
 *   Evita falsos positivos como "Esto es importante"
 */
const DATE_QUERY_PATTERNS = [
  /(?:qu[eé]\s+)?d[ií]a\s+\b(?:es|tengo)\b(?:\s+el\s+turno)?/i,
  // "cuándo es" + OPCIONAL contexto, O "es/tengo" + REQUERIDO contexto de cita
  /(?:cu[aá]ndo\s+\b(?:es|tengo)\b)|(?:es|tengo)\b\s+(?:el\s+)?(?:turno|hoy|mañana|mi|a\s+las)/i,
  /(?:para\s+)?(?:qu[eé]\s+)?fecha/i,
  /(?:cu[aá]l\s+es\s+)?(?:la\s+)?fecha\s+(?:del\s+turno)?/i,
]

/**
 * Patrones de consulta de SEDE
 */
const VENUE_QUERY_PATTERNS = [
  /(?:en\s+)?(?:qu[eé]|cu[aá]l)\s+sede/i,
  /(?:en\s+)?(?:qu[eé]|cu[aá]l)\s+sucursal/i,
  /(?:en\s+)?(?:qu[eé]|cu[aá]l)\s+(?:lugar|clinica|cl[ií]nica)/i,
]

/**
 * Patrones de consulta GENERAL del turno
 */
const GENERAL_APPOINTMENT_QUERY_PATTERNS = [
  /(?:me\s+)?(?:pod[eé]s|podes)\s+(?:dar|pasar)\s+(?:los\s+)?datos\s+(?:del\s+turno)?/i,
  /(?:cu[aá]les\s+son\s+)?(?:los\s+)?datos\s+(?:del\s+turno)/i,
  /info(?:rmaci[oó]n)?\s+(?:del\s+)?turno/i,
  /detalles?\s+(?:del\s+)?turno/i,
  /recordar(?:me)?\s+(?:el\s+)?turno/i,
]

// ============================================================================
// FUNCIONES DE DETECCIÓN POR PATRONES
// ============================================================================

/**
 * Detecta el tipo de consulta informativa basándose en patrones regex
 * 
 * NOTA: Los regex de consultas informativas han sido DESACTIVADOS para evitar
 * falsos positivos (ej: "Necesito preparación?" matcheaba como DATE_QUERY).
 * 
 * Ahora estas consultas son manejadas por el NLU Fallback Router (Sprint 18)
 * que clasifica con GPT-4o-mini y evita los problemas de regex ambiguos.
 * 
 * Se mantienen los patrones comentados para referencia.
 * 
 * @deprecated Usar NLU Fallback Router (Sprint 18) para consultas informativas
 */
export function detectInformationalQueryType(message: string): InformationalQueryType {
  // DESACTIVADO: Los regex generan falsos positivos
  // El NLU Fallback Router (Sprint 18) maneja estas consultas
  return "unknown"
  
  /* PATRONES ORIGINALES (desactivados):
  const cleanMessage = message.trim()
  
  // Verificar cada tipo en orden de especificidad
  if (ADDRESS_QUERY_PATTERNS.some(p => p.test(cleanMessage))) {
    return "direccion"
  }
  
  if (SCHEDULE_QUERY_PATTERNS.some(p => p.test(cleanMessage))) {
    return "horario"
  }
  
  if (PROFESSIONAL_QUERY_PATTERNS.some(p => p.test(cleanMessage))) {
    return "profesional"
  }
  
  if (DATE_QUERY_PATTERNS.some(p => p.test(cleanMessage))) {
    return "fecha"
  }
  
  if (VENUE_QUERY_PATTERNS.some(p => p.test(cleanMessage))) {
    return "sede"
  }
  
  if (GENERAL_APPOINTMENT_QUERY_PATTERNS.some(p => p.test(cleanMessage))) {
    return "general"
  }
  
  return "unknown"
  */
}

/**
 * Verifica si el mensaje es una consulta informativa
 */
export function isInformationalQuery(message: string): boolean {
  return detectInformationalQueryType(message) !== "unknown"
}

/**
 * Keywords que podrían indicar una consulta informativa
 * Usados para decidir si llamar al NLU en casos ambiguos
 */
const INFORMATIONAL_KEYWORDS = [
  "direccion",
  "dirección",
  "ubicacion",
  "ubicación",
  "donde",
  "dónde",
  "hora",
  "horario",
  "cuando",
  "cuándo",
  "fecha",
  "dia",
  "día",
  "quien",
  "quién",
  "doctor",
  "medico",
  "médico",
  "profesional",
  "sede",
  "sucursal",
  "lugar",
  "datos",
  "información",
  "informacion",
  "detalles",
  "recordar",
  "calle",
  "llego",
  "llegar",
]

/**
 * Detecta si el mensaje PODRÍA ser una consulta informativa (contiene keywords)
 * pero necesita NLU para confirmar
 * 
 * @deprecated DESACTIVADO - El NLU Fallback Router (Sprint 18) maneja estas consultas
 */
export function mightBeInformationalQuery(message: string): boolean {
  // DESACTIVADO: El NLU Fallback Router (Sprint 18) maneja todas las consultas
  // Esto evita que el handler llame al NLU antiguo
  return false
  
  /* LÓGICA ORIGINAL (desactivada):
  const lowerMessage = message.toLowerCase().trim()
  
  // Si ya es detectado por patrones, es seguro
  if (isInformationalQuery(message)) {
    return true
  }
  
  // Verificar si contiene keywords
  return INFORMATIONAL_KEYWORDS.some(keyword => lowerMessage.includes(keyword))
  */
}

// ============================================================================
// CLASIFICACIÓN CON NLU
// ============================================================================

export interface InformationalQueryNLUResult {
  isInformationalQuery: boolean
  queryType: InformationalQueryType
  confidence: number
  reasoning: string
}

/**
 * Llama al NLU de OpenAI para clasificar consultas informativas ambiguas
 */
export async function classifyWithNLU(
  message: string,
  userPhone: string,
  configId: string
): Promise<InformationalQueryNLUResult> {
  const logger = createConversationLogger(userPhone, configId, "informational-nlu")

  // Si no hay asistente configurado, usar fallback por reglas
  if (!INFORMATIONAL_QUERY_NLU_ASSISTANT_ID) {
    logger.info("NLU no configurado, usando fallback por reglas")
    return classifyByRules(message)
  }

  try {
    // Crear thread para la clasificación
    const thread = await openai.beta.threads.create()

    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: `Clasifica el siguiente mensaje:\n\n"${message}"`,
    })

    const run = await openai.beta.threads.runs.createAndPoll(thread.id, {
      assistant_id: INFORMATIONAL_QUERY_NLU_ASSISTANT_ID,
    })

    if (run.status !== "completed") {
      logger.error("Run no completado", { status: run.status })
      return classifyByRules(message)
    }

    const messages = await openai.beta.threads.messages.list(thread.id)
    const assistantMessage = messages.data
      .filter((msg) => msg.role === "assistant")
      .at(0)

    if (!assistantMessage) {
      logger.error("No se encontró mensaje del asistente")
      return classifyByRules(message)
    }

    const responseContent = assistantMessage.content[0]
    if (responseContent.type !== "text") {
      return classifyByRules(message)
    }

    let cleanJson = responseContent.text.value.trim()
    if (cleanJson.startsWith("```")) {
      cleanJson = cleanJson.replace(/```json?\n?/g, "").replace(/```/g, "").trim()
    }

    const parsed = JSON.parse(cleanJson)
    
    logger.info("NLU clasificación exitosa", {
      isInformationalQuery: parsed.isInformationalQuery,
      queryType: parsed.queryType,
      confidence: parsed.confidence,
    })

    return {
      isInformationalQuery: parsed.isInformationalQuery,
      queryType: parsed.queryType as InformationalQueryType,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
    }
  } catch (error) {
    logger.error("Error en NLU de consulta informativa", error as Error)
    return classifyByRules(message)
  }
}

/**
 * Clasificación por reglas como fallback cuando NLU no está disponible
 */
function classifyByRules(message: string): InformationalQueryNLUResult {
  const queryType = detectInformationalQueryType(message)
  
  if (queryType !== "unknown") {
    return {
      isInformationalQuery: true,
      queryType,
      confidence: 0.90,
      reasoning: "Coincide con patrón de consulta informativa",
    }
  }
  
  // Si contiene signo de interrogación y keywords, probablemente es consulta
  if (message.includes("?") && mightBeInformationalQuery(message)) {
    return {
      isInformationalQuery: true,
      queryType: "general",
      confidence: 0.70,
      reasoning: "Contiene signo de interrogación y keywords informativos",
    }
  }
  
  return {
    isInformationalQuery: false,
    queryType: "unknown",
    confidence: 0.50,
    reasoning: "No se detectó consulta informativa",
  }
}

// ============================================================================
// GENERACIÓN DE RESPUESTAS
// ============================================================================

/**
 * Construye la respuesta para una consulta de dirección
 */
export function buildAddressResponse(appointmentData: ChatbotData): string {
  const turno = appointmentData.turno || appointmentData.turnos?.[0]
  
  if (!turno) {
    return "No encontré información del turno. ¿Podrías indicarme con qué turno necesitás ayuda?"
  }
  
  const direccion = turno.direccion || "No disponible"
  const sede = turno.sede || appointmentData.clinica || "la clínica"
  
  if (direccion && direccion !== "No disponible") {
    return `La dirección de ${sede} es:\n\n📍 *${direccion}*\n\n¿Hay algo más en lo que pueda ayudarte?`
  }
  
  return `Tu turno es en *${sede}*. Para la dirección exacta, te recomiendo contactar directamente a la clínica.\n\n¿Hay algo más en lo que pueda ayudarte?`
}

/**
 * Construye la respuesta para una consulta de horario
 */
export function buildScheduleResponse(appointmentData: ChatbotData): string {
  const turno = appointmentData.turno || appointmentData.turnos?.[0]
  
  if (!turno) {
    return "No encontré información del turno. ¿Podrías indicarme con qué turno necesitás ayuda?"
  }
  
  const hora = turno.hora_formateada || turno.hora || "No disponible"
  const fecha = turno.fecha_formateada || turno.fecha || ""
  
  return `Tu turno es a las *${hora}*${fecha ? ` el ${fecha}` : ""}.\n\n¿Hay algo más en lo que pueda ayudarte?`
}

/**
 * Construye la respuesta para una consulta de profesional
 */
export function buildProfessionalResponse(appointmentData: ChatbotData): string {
  const turno = appointmentData.turno || appointmentData.turnos?.[0]
  
  if (!turno) {
    return "No encontré información del turno. ¿Podrías indicarme con qué turno necesitás ayuda?"
  }
  
  const profesional = turno.profesional || "No disponible"
  
  return `Tu turno es con *${profesional}*.\n\n¿Hay algo más en lo que pueda ayudarte?`
}

/**
 * Construye la respuesta para una consulta de fecha
 */
export function buildDateResponse(appointmentData: ChatbotData): string {
  const turno = appointmentData.turno || appointmentData.turnos?.[0]
  
  if (!turno) {
    return "No encontré información del turno. ¿Podrías indicarme con qué turno necesitás ayuda?"
  }
  
  const fecha = turno.fecha_formateada || turno.fecha || "No disponible"
  const hora = turno.hora_formateada || turno.hora || ""
  
  return `Tu turno es el *${fecha}*${hora ? ` a las ${hora}` : ""}.\n\n¿Hay algo más en lo que pueda ayudarte?`
}

/**
 * Construye la respuesta para una consulta de sede
 */
export function buildVenueResponse(appointmentData: ChatbotData): string {
  const turno = appointmentData.turno || appointmentData.turnos?.[0]
  
  if (!turno) {
    return "No encontré información del turno. ¿Podrías indicarme con qué turno necesitás ayuda?"
  }
  
  const sede = turno.sede || appointmentData.clinica || "No disponible"
  const direccion = turno.direccion || ""
  
  if (direccion) {
    return `Tu turno es en *${sede}*.\n\n📍 Dirección: ${direccion}\n\n¿Hay algo más en lo que pueda ayudarte?`
  }
  
  return `Tu turno es en *${sede}*.\n\n¿Hay algo más en lo que pueda ayudarte?`
}

/**
 * Construye la respuesta para una consulta general del turno
 */
export function buildGeneralAppointmentResponse(appointmentData: ChatbotData): string {
  const turno = appointmentData.turno || appointmentData.turnos?.[0]
  
  if (!turno) {
    return "No encontré información del turno. ¿Podrías indicarme con qué turno necesitás ayuda?"
  }
  
  const fecha = turno.fecha_formateada || turno.fecha || "No disponible"
  const hora = turno.hora_formateada || turno.hora || "No disponible"
  const profesional = turno.profesional || "No disponible"
  const sede = turno.sede || appointmentData.clinica || "No disponible"
  const direccion = turno.direccion || ""
  
  let response = `Acá están los datos de tu turno:\n\n`
  response += `📅 *Fecha:* ${fecha}\n`
  response += `🕐 *Hora:* ${hora}\n`
  response += `👨‍⚕️ *Profesional:* ${profesional}\n`
  response += `🏥 *Sede:* ${sede}\n`
  
  if (direccion) {
    response += `📍 *Dirección:* ${direccion}\n`
  }
  
  response += `\n¿Hay algo más en lo que pueda ayudarte?`
  
  return response
}

/**
 * Construye la respuesta apropiada según el tipo de consulta
 */
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
    case "fecha":
      return buildDateResponse(appointmentData)
    case "sede":
      return buildVenueResponse(appointmentData)
    case "general":
    default:
      return buildGeneralAppointmentResponse(appointmentData)
  }
}

// ============================================================================
// FUNCIÓN PRINCIPAL DE DETECCIÓN PRE-FLUJO
// ============================================================================

export interface InformationalQueryResult {
  detected: boolean
  queryType: InformationalQueryType
  response?: string
  confidence?: number
}

/**
 * Detecta si el mensaje es una consulta informativa y genera la respuesta apropiada.
 * 
 * Esta función se llama ANTES de la detección de paciente para evitar
 * reiniciar el flujo cuando el usuario solo pregunta por información.
 * 
 * @param message - Mensaje del usuario
 * @param userPhone - Teléfono del usuario
 * @param configId - ID de configuración
 * @param appointmentData - Datos del turno (si existe)
 * @param useNLU - Si usar NLU para casos ambiguos
 */
export async function detectInformationalQueryPreFlow(
  message: string,
  userPhone: string,
  configId: string,
  appointmentData: ChatbotData | null,
  useNLU: boolean = true
): Promise<InformationalQueryResult> {
  const logger = createConversationLogger(userPhone, configId, "informational-query-preflow")

  // Paso 1: Verificar patrón directo (0ms latencia)
  const directQueryType = detectInformationalQueryType(message)
  
  if (directQueryType !== "unknown") {
    logger.info("Consulta informativa detectada por patrón", { 
      queryType: directQueryType,
      message: message.substring(0, 50)
    })
    
    // Si no hay datos del turno, no podemos responder
    if (!appointmentData) {
      logger.info("No hay appointmentData, no se puede responder consulta informativa")
      return { detected: false, queryType: "unknown" }
    }
    
    const response = buildInformationalResponse(directQueryType, appointmentData)
    return {
      detected: true,
      queryType: directQueryType,
      response,
      confidence: 0.95
    }
  }

  // Paso 2: Si no parece consulta informativa en absoluto, salir rápido
  if (!mightBeInformationalQuery(message)) {
    return { detected: false, queryType: "unknown" }
  }

  // Paso 3: Caso ambiguo - usar NLU si está habilitado
  if (useNLU) {
    logger.info("Caso ambiguo, usando NLU", { message: message.substring(0, 50) })
    
    const classification = await classifyWithNLU(message, userPhone, configId)
    
    logger.info("Clasificación NLU", {
      isInformationalQuery: classification.isInformationalQuery,
      queryType: classification.queryType,
      confidence: classification.confidence,
    })

    if (classification.isInformationalQuery && classification.confidence >= 0.70) {
      // Si no hay datos del turno, no podemos responder
      if (!appointmentData) {
        logger.info("NLU detectó consulta pero no hay appointmentData")
        return { detected: false, queryType: "unknown" }
      }
      
      const response = buildInformationalResponse(classification.queryType, appointmentData)
      return {
        detected: true,
        queryType: classification.queryType,
        response,
        confidence: classification.confidence
      }
    }
  }

  return { detected: false, queryType: "unknown" }
}

/**
 * Configura el ID del asistente NLU para consultas informativas
 */
export function setInformationalQueryNLUAssistantId(assistantId: string): void {
  // @ts-ignore - Permitir asignación a constante en runtime
  INFORMATIONAL_QUERY_NLU_ASSISTANT_ID = assistantId
}
