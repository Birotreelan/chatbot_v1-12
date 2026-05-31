/**
 * Sprint 3: Despedidas Anti-Repetición
 * Sprint 12: Detección de despedida pre-flujo con NLU para casos ambiguos
 * 
 * Detecta despedidas múltiples y evita que OpenAI repita la misma despedida
 * Implementa MODO A (cierre completo) vs MODO B (cierre breve)
 * 
 * IMPORTANTE: Solo se activa cuando hay un recordatorio previo (contexto de turno).
 * La verificación de recordatorio previo se hace en whatsapp.tsx ANTES de llamar aquí.
 */

import { createConversationLogger } from "./logger"
import { getRedisClient } from "@/lib/redis"
import { openai } from "@/lib/openai"
import { getArgentinaHour } from "@/lib/utils/date-utils"

// ID del asistente NLU de despedida creado en OpenAI Platform
const FAREWELL_NLU_ASSISTANT_ID = "asst_68NiTYXUNHnyqyvY04VrZLk7"

const FAREWELL_KEYWORDS = [
  "gracias",
  "muchas gracias", 
  "mil gracias",
  "ok",
  "listo",
  "dale",
  "perfecto",
  "bueno",
  "buenísimo",
  "un gusto",
  "hasta luego",
  "chau",
  "adiós",
]

// Patrones de despedida PURA (sin ambigüedad)
// Si coincide con estos, es despedida segura sin necesidad de NLU
const PURE_FAREWELL_PATTERNS = [
  /^\.?(?:muchas?\s+)?gracias(?:\s*[!.]+)?$/i,
  /^(?:ok|bueno|perfecto|listo|dale)\s*,?\s*(?:muchas?\s+)?gracias[!.]*$/i,
  /^(?:chau|adiós|adios|hasta\s+luego|nos\s+vemos|bye)(?:\s*[!.]+)?$/i,
  /^bueno\s+(?:chau|hasta\s+luego)[!.]*$/i,
  /^gracias\s+(?:chau|hasta\s+luego)[!.]*$/i,
  /^(?:mil\s+)?gracias\s+por\s+todo[!.]*$/i,
]

// Palabras que indican intención de iniciar una nueva consulta (NO despedirse)
// Esta es una capa de seguridad adicional para evitar falsos positivos
const NON_FAREWELL_INDICATORS = [
  "turno",
  "sacar turno",
  "quiero",
  "necesito",
  "consulta",
  "quisiera",
  "puedo",
  "podría",
  "ayuda",
  "información",
  "informacion",
  "cancelar",
  "cambiar",
  "reagendar",
]

// ============================================================================
// RESPUESTAS RECIPROCAS A DESPEDIDAS
// Detecta cuando el usuario responde "igualmente", "vos tambien", etc.
// a una despedida previa del bot. En estos casos NO debemos responder nada.
// ============================================================================

// Patrones de respuesta reciproca a despedida (el usuario responde a nuestra despedida)
// Estos NO requieren respuesta del bot - silencio total
const RECIPROCAL_FAREWELL_PATTERNS = [
  // "Igualmente" y variantes
  /^\.?igualmente\.?[!]*$/i,
  /^\.?igual\.?[!]*$/i,
  /^\.?(?:para\s+)?(?:vos|ti|usted)\s+(?:tambien|también)\.?[!]*$/i,
  /^\.?(?:lo\s+mismo\s+)?(?:para\s+)?(?:vos|ti|usted)\.?[!]*$/i,
  /^\.?que\s+(?:te|le)\s+vaya\s+bien\.?[!]*$/i,
  
  // Despedidas cortas de cierre
  /^\.?(?:chau|chao|bye|adiós|adios)\.?[!]*$/i,
  /^\.?nos\s+vemos\.?[!]*$/i,
  /^\.?hasta\s+(?:luego|pronto|la\s+(?:proxima|próxima))\.?[!]*$/i,
  /^\.?(?:buen|buena)\s+(?:dia|día|tarde|noche)\.?[!]*$/i,
  
  // Combinaciones con igualmente
  /^\.?(?:gracias,?\s*)?igualmente\.?[!]*$/i,
  /^\.?igualmente,?\s*(?:gracias|chau|hasta\s+luego)\.?[!]*$/i,
  
  // Saludos de cierre muy cortos
  /^\.?saludos\.?[!]*$/i,
  /^\.?un\s+abrazo\.?[!]*$/i,
  /^\.?cuidate\.?[!]*$/i,
  /^\.?cuídate\.?[!]*$/i,
]

/**
 * Detecta si el mensaje es una respuesta reciproca a una despedida del bot
 * Ej: "Igualmente", "Vos también", "Para ti también"
 */
export function isReciprocalFarewellPattern(message: string): boolean {
  const cleanMessage = message.trim()
  return RECIPROCAL_FAREWELL_PATTERNS.some((pattern) => pattern.test(cleanMessage))
}

const FAREWELL_MODE_A_TEMPLATES = [
  "Si necesitás algo más, no dudes en escribirme.",
  "Cualquier cosa, no dudes en comunicarte.",
  "Estoy acá si necesitás algo más.",
]

const FAREWELL_MODE_B_TEMPLATES = [
  "¡A vos!",
  "¡Un gusto!",
  "¡Listo!",
  "¡Cualquier cosa por acá estoy!",
  "¡Nos vemos!",
  "¡Perfecto!",
]

export interface FarewellState {
  farewell_sent: boolean
  farewell_sent_at: string
  last_farewell_mode: "A" | "B"
}

/**
 * Detecta si el mensaje contiene indicadores de que NO es una despedida
 * (el usuario quiere hacer algo más, no despedirse)
 */
function containsNonFarewellIndicator(message: string): boolean {
  const lowerMessage = message.toLowerCase().trim()
  return NON_FAREWELL_INDICATORS.some((indicator) =>
    lowerMessage.includes(indicator)
  )
}

/**
 * Detecta si el mensaje es una despedida PURA usando patrones regex
 * Estos son casos 100% seguros que no necesitan NLU
 */
export function isPureFarewellPattern(message: string): boolean {
  const cleanMessage = message.trim()
  return PURE_FAREWELL_PATTERNS.some((pattern) => pattern.test(cleanMessage))
}

/**
 * Detecta si el mensaje PODRÍA ser despedida (contiene keywords)
 * pero necesita NLU para confirmar si es despedida pura o consulta con cortesía
 */
export function mightBeFarewell(message: string): boolean {
  const lowerMessage = message.toLowerCase().trim()
  return FAREWELL_KEYWORDS.some((keyword) => lowerMessage.includes(keyword))
}

/**
 * Tipo de intención detectada por el NLU de despedida
 */
export type FarewellIntent = "despedida_pura" | "consulta_con_cortesia" | "otro"

/**
 * Llama al NLU de OpenAI para clasificar si es despedida pura o consulta con cortesía
 */
export async function classifyFarewellWithNLU(
  message: string,
  userPhone: string,
  configId: string
): Promise<{ intent: FarewellIntent; confidence: number; reasoning: string }> {
  const logger = createConversationLogger(userPhone, configId, "farewell-nlu")

  // Si no hay asistente configurado, usar fallback por reglas
  if (!FAREWELL_NLU_ASSISTANT_ID) {
    logger.info("NLU no configurado, usando fallback por reglas")
    return classifyFarewellByRules(message)
  }

  try {
    // Crear thread para la clasificación
    const thread = await openai.beta.threads.create()

    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: `Clasifica el siguiente mensaje:\n\n"${message}"`,
    })

    const run = await openai.beta.threads.runs.createAndPoll(thread.id, {
      assistant_id: FAREWELL_NLU_ASSISTANT_ID,
    })

    if (run.status !== "completed") {
      logger.error("Run no completado", { status: run.status })
      return classifyFarewellByRules(message)
    }

    const messages = await openai.beta.threads.messages.list(thread.id)
    const assistantMessage = messages.data
      .filter((msg) => msg.role === "assistant")
      .at(0)

    if (!assistantMessage) {
      logger.error("No se encontró mensaje del asistente")
      return classifyFarewellByRules(message)
    }

    const responseContent = assistantMessage.content[0]
    if (responseContent.type !== "text") {
      return classifyFarewellByRules(message)
    }

    let cleanJson = responseContent.text.value.trim()
    if (cleanJson.startsWith("```")) {
      cleanJson = cleanJson.replace(/```json?\n?/g, "").replace(/```/g, "").trim()
    }

    const parsed = JSON.parse(cleanJson)
    
    logger.info("NLU clasificación exitosa", {
      intent: parsed.intent,
      confidence: parsed.confidence,
    })

    return {
      intent: parsed.intent as FarewellIntent,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
    }
  } catch (error) {
    logger.error("Error en NLU de despedida", error as Error)
    return classifyFarewellByRules(message)
  }
}

/**
 * Clasificación por reglas como fallback cuando NLU no está disponible
 */
function classifyFarewellByRules(message: string): { intent: FarewellIntent; confidence: number; reasoning: string } {
  const lowerMessage = message.toLowerCase().trim()
  
  // Si es patrón puro, es despedida segura
  if (isPureFarewellPattern(message)) {
    return {
      intent: "despedida_pura",
      confidence: 0.95,
      reasoning: "Coincide con patrón de despedida pura",
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
  
  // Si contiene indicadores de no-despedida, es consulta
  if (containsNonFarewellIndicator(lowerMessage)) {
    return {
      intent: "consulta_con_cortesia",
      confidence: 0.80,
      reasoning: "Contiene indicadores de consulta/solicitud",
    }
  }
  
  // Si es mensaje corto con keyword de despedida, es despedida
  if (message.length < 30 && mightBeFarewell(message)) {
    return {
      intent: "despedida_pura",
      confidence: 0.75,
      reasoning: "Mensaje corto con keyword de despedida",
    }
  }
  
  return {
    intent: "otro",
    confidence: 0.50,
    reasoning: "No se pudo clasificar con certeza",
  }
}

/**
 * Detecta si el mensaje es una despedida genuina
 * 
 * Reglas:
 * 1. Debe contener una keyword de despedida
 * 2. NO debe contener indicadores de nueva consulta
 * 3. Mensajes muy largos (>50 chars) probablemente NO son despedidas simples
 * 
 * NOTA: La verificación de recordatorio previo se hace en whatsapp.tsx
 */
export function isFarewellMessage(message: string): boolean {
  const lowerMessage = message.toLowerCase().trim()
  
  // Si contiene indicadores de nueva consulta, NO es despedida
  if (containsNonFarewellIndicator(lowerMessage)) {
    return false
  }
  
  // Mensajes muy largos no son despedidas simples
  if (message.length > 50) {
    return false
  }
  
  return FAREWELL_KEYWORDS.some((keyword) =>
    lowerMessage.includes(keyword)
  )
}

/**
 * Obtiene el estado de despedida de Redis
 */
async function getFarewellState(
  userPhone: string,
  configId: string
): Promise<FarewellState | null> {
  const redis = getRedisClient()
  if (!redis) return null

  try {
    const key = `farewell:${configId}:${userPhone}`
    const data = await redis.get(key)
    if (!data) return null

    return JSON.parse(data as string) as FarewellState
  } catch (error) {
    console.error("[FAREWELL] Error leyendo estado de despedida:", error)
    return null
  }
}

/**
 * Guarda el estado de despedida en Redis (TTL 1 hora)
 */
async function setFarewellState(
  userPhone: string,
  configId: string,
  state: FarewellState
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  try {
    const key = `farewell:${configId}:${userPhone}`
    const ttlSeconds = 3600 // 1 hora
    await redis.setex(key, ttlSeconds, JSON.stringify(state))
  } catch (error) {
    console.error("[FAREWELL] Error guardando estado de despedida:", error)
  }
}

/**
 * Limpia el estado de despedida
 */
async function clearFarewellState(
  userPhone: string,
  configId: string
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  try {
    const key = `farewell:${configId}:${userPhone}`
    await redis.del(key)
  } catch (error) {
    console.error("[FAREWELL] Error limpiando estado de despedida:", error)
  }
}

/**
 * Selecciona una plantilla aleatoria del banco correspondiente
 */
function selectFarewellTemplate(mode: "A" | "B"): string {
  const templates = mode === "A" ? FAREWELL_MODE_A_TEMPLATES : FAREWELL_MODE_B_TEMPLATES
  return templates[Math.floor(Math.random() * templates.length)]
}

/**
 * Obtiene el saludo de despedida según la hora del día en Argentina
 */
function getTimeBasedGreeting(): string {
  const hour = getArgentinaHour()
  
  if (hour >= 5 && hour < 12) {
    return "¡Que tengas un excelente día!"
  } else if (hour >= 12 && hour < 18) {
    return "¡Que disfrutes la tarde!"
  } else if (hour >= 18 && hour < 22) {
    return "¡Que tengas buena noche!"
  } else {
    return "¡Que descanses!"
  }
}

/**
 * Maneja despedidas detectadas
 * Retorna:
 * - null: no es despedida, continuar a OpenAI
 * - string: mensaje de despedida directo, NO pasar a OpenAI
 */
export async function handleFarewellIfDetected(
  message: string,
  userPhone: string,
  configId: string,
  patientName: string
): Promise<string | null> {
  const logger = createConversationLogger(userPhone, configId, "farewell")

  // Verificar si es mensaje de despedida
  if (!isFarewellMessage(message)) {
    return null
  }

  logger.info("Mensaje de despedida detectado", { message })

  // Obtener estado actual
  const currentState = await getFarewellState(userPhone, configId)

  if (!currentState || !currentState.farewell_sent) {
    // MODO A: Primera despedida (cierre completo)
    logger.info("Primera despedida - usando MODO A (cierre completo)")

    const template = selectFarewellTemplate("A")
    const timeGreeting = getTimeBasedGreeting()
    const farewellResponse = `¡${patientName}! ${template} ${timeGreeting}`

    // Marcar despedida como enviada
    await setFarewellState(userPhone, configId, {
      farewell_sent: true,
      farewell_sent_at: new Date().toISOString(),
      last_farewell_mode: "A",
    })

    logger.info("Despedida MODO A enviada", {
      response: farewellResponse,
    })

    return farewellResponse
  } else {
    // MODO B: Despedida posterior (cierre breve)
    logger.info("Despedida posterior - usando MODO B (cierre breve)")

    const template = selectFarewellTemplate("B")
    const farewellResponse = `¡${template}!`

    // No actualizar el estado, mantener farewell_sent = true

    logger.info("Despedida MODO B enviada", {
      response: farewellResponse,
    })

    return farewellResponse
  }
}

/**
 * Exporta funciones para testing/debugging
 */
export const FarewellDebug = {
  getFarewellState,
  setFarewellState,
  clearFarewellState,
  getTimeBasedGreeting,
  selectFarewellTemplate,
  isFarewellMessage,
}

/**
 * Detecta si el mensaje es una respuesta reciproca a una despedida del bot
 * y si corresponde NO responder nada (silencio).
 * 
 * Casos detectados:
 * - "Igualmente" despues de "Que disfrutes la tarde!"
 * - "Vos tambien" despues de cualquier despedida del bot
 * - "Para ti tambien" despues de despedida
 * 
 * @returns { shouldSilence: true } si debemos NO responder
 * @returns { shouldSilence: false } si debemos continuar con flujo normal
 */
export async function detectReciprocalFarewellPreFlow(
  message: string,
  userPhone: string,
  configId: string
): Promise<{ shouldSilence: boolean; reason?: string }> {
  const logger = createConversationLogger(userPhone, configId, "farewell-reciprocal")

  // Paso 1: Verificar si el mensaje es una respuesta reciproca
  if (!isReciprocalFarewellPattern(message)) {
    return { shouldSilence: false }
  }

  logger.info("Patron de respuesta reciproca detectado", { message })

  // Paso 2: Verificar si el bot envio una despedida recientemente
  const farewellState = await getFarewellState(userPhone, configId)
  
  if (farewellState && farewellState.farewell_sent) {
    // Verificar que la despedida fue reciente (dentro de 10 minutos)
    const farewellTime = new Date(farewellState.farewell_sent_at).getTime()
    const now = Date.now()
    const tenMinutes = 10 * 60 * 1000
    
    if (now - farewellTime < tenMinutes) {
      logger.info("Despedida reciente encontrada, aplicando silencio", {
        farewellSentAt: farewellState.farewell_sent_at,
        minutesAgo: Math.round((now - farewellTime) / 60000),
      })
      
      return {
        shouldSilence: true,
        reason: "Respuesta reciproca a despedida reciente del bot",
      }
    }
  }

  // Si no hay despedida reciente, podria ser inicio de conversacion
  // En ese caso, no silenciamos
  logger.info("No hay despedida reciente, continuando flujo normal")
  return { shouldSilence: false }
}

/**
 * Sprint 12: Detección de despedida pre-flujo
 * 
 * Detecta despedidas ANTES de iniciar la detección de paciente.
 * Usa patrones para casos simples y NLU para casos ambiguos.
 * 
 * @returns string con respuesta de despedida, o null si no es despedida
 */
export async function detectFarewellPreFlow(
  message: string,
  userPhone: string,
  configId: string,
  useNLU: boolean = true
): Promise<{ isFarewell: boolean; response?: string }> {
  const logger = createConversationLogger(userPhone, configId, "farewell-preflow")

  // Paso 1: Verificar patrón puro (0ms latencia)
  if (isPureFarewellPattern(message)) {
    logger.info("Despedida pura detectada por patrón", { message })
    
    const response = buildSimpleFarewellResponse()
    return { isFarewell: true, response }
  }

  // Paso 2: Si no parece despedida en absoluto, salir rápido
  if (!mightBeFarewell(message)) {
    return { isFarewell: false }
  }

  // Paso 3: Caso ambiguo - usar NLU si está habilitado
  if (useNLU) {
    logger.info("Caso ambiguo, usando NLU", { message })
    
    const classification = await classifyFarewellWithNLU(message, userPhone, configId)
    
    logger.info("Clasificación NLU", {
      intent: classification.intent,
      confidence: classification.confidence,
    })

    if (classification.intent === "despedida_pura" && classification.confidence >= 0.70) {
      const response = buildSimpleFarewellResponse()
      return { isFarewell: true, response }
    }

    // consulta_con_cortesia u otro = no es despedida, continuar flujo normal
    return { isFarewell: false }
  }

  // Sin NLU, usar fallback por reglas
  const fallback = classifyFarewellByRules(message)
  if (fallback.intent === "despedida_pura" && fallback.confidence >= 0.75) {
    const response = buildSimpleFarewellResponse()
    return { isFarewell: true, response }
  }

  return { isFarewell: false }
}

/**
 * Construye una respuesta de despedida simple para el flujo pre-detección
 */
function buildSimpleFarewellResponse(): string {
  const greetings = [
    "¡Gracias por comunicarte! Si necesitás algo más, estoy acá para ayudarte.",
    "¡Un placer! Cualquier consulta, no dudes en escribirme.",
    "¡Gracias! Estoy a tu disposición cuando lo necesites.",
  ]
  
  const timeGreeting = getTimeBasedGreeting()
  const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)]
  
  return `${randomGreeting} ${timeGreeting}`
}

/**
 * Configura el ID del asistente NLU de despedida
 */
export function setFarewellNLUAssistantId(assistantId: string): void {
  // @ts-ignore - Permitir asignación a constante en runtime
  FAREWELL_NLU_ASSISTANT_ID = assistantId
}
