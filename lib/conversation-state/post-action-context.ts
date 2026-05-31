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
  | "consulta_turno"           // Pregunta sobre el turno recién procesado
  | "nueva_accion"             // Quiere realizar otra acción (reservar, cancelar, etc)
  | "agradecimiento"           // Cierre de conversación
  | "explicacion_contextual"   // Explicación de por qué realizó la acción (ej: "Está con neumonía")
  | "otro"                     // No clasificable

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
 * System prompt para clasificación de intención post-acción usando GPT-4o-mini
 */
const POST_ACTION_NLU_SYSTEM_PROMPT = `Eres un clasificador de intenciones para un chatbot de turnos médicos.

El paciente acaba de completar una ACCIÓN sobre su turno (confirmar, cancelar, reservar, reagendar).
Tu tarea es clasificar qué tipo de mensaje envía DESPUÉS de esa acción.

## INTENCIONES POSIBLES:

1. **explicacion_contextual** - El paciente EXPLICA por qué realizó la acción:
   - "Está con neumonía" (explica por qué canceló)
   - "La paciente falleció" (explica por qué canceló)
   - "Se mudó a otra ciudad"
   - "Me internaron", "Estoy enfermo"
   - "Tuvo un accidente", "Tiene COVID"
   - "Cambió de obra social"
   - "No puede caminar"
   - Cualquier motivo/razón/explicación de la acción reciente

2. **agradecimiento** - Cierre de conversación, cortesía:
   - "Gracias", "Muchas gracias"
   - "Ok", "Bueno", "Perfecto", "Listo"
   - "Chau", "Hasta luego", "Nos vemos"

3. **consulta_turno** - Pregunta sobre información del turno:
   - "¿Cuál es la dirección?"
   - "¿A qué hora es?"
   - "¿Con quién es el turno?"
   - Cualquier pregunta con "?"

4. **nueva_accion** - Quiere realizar OTRA acción diferente:
   - "Quiero sacar otro turno"
   - "Necesito cancelar otro turno"
   - "Quiero reagendar"
   - Solicitudes de acciones nuevas

5. **otro** - No encaja en ninguna categoría clara

## REGLAS DE CLASIFICACIÓN:

- Si el mensaje contiene una EXPLICACIÓN o MOTIVO (enfermedad, fallecimiento, situación personal, etc.) → "explicacion_contextual"
- Si el mensaje es una PREGUNTA con "?" sobre datos del turno → "consulta_turno"
- Si el mensaje es corto y de cortesía → "agradecimiento"
- Si el mensaje solicita una NUEVA ACCIÓN → "nueva_accion"
- En caso de duda, preferir "explicacion_contextual" si parece dar información contextual

## FORMATO DE RESPUESTA:

Responde SOLO con JSON válido:
{
  "intent": "explicacion_contextual" | "agradecimiento" | "consulta_turno" | "nueva_accion" | "otro",
  "confidence": 0.0-1.0,
  "reasoning": "explicación breve"
}`

/**
 * Detecta la intención de un mensaje post-acción usando GPT-4o-mini
 * Usa chat completions directamente para mayor confiabilidad
 */
export async function detectPostActionIntent(
  userMessage: string,
  context: PostActionContext,
  phoneNumber: string,
  configId: string
): Promise<PostActionIntentResult> {
  const logger = createConversationLogger(phoneNumber, configId, "post-action-nlu")
  
  try {
    const actionLabel = {
      confirmation: "confirmó asistencia a",
      cancellation: "canceló", 
      booking: "reservó",
      reschedule: "reagendó",
    }[context.actionType]

    const userPrompt = `## Contexto de la conversación
El paciente "${context.paciente.nombres}" ${actionLabel} su turno hace ${Math.round((Date.now() - context.timestamp) / 1000 / 60)} minutos.

Turno:
- Fecha: ${context.turno.fecha}
- Hora: ${context.turno.hora}
- Profesional: ${context.turno.profesional}
- Sede: ${context.turno.sede}

## Mensaje del paciente a clasificar:
"${userMessage}"

Clasifica la intención del mensaje.`

    logger.debug("Llamando a GPT-4o-mini para clasificación", { 
      messageLength: userMessage.length,
      actionType: context.actionType 
    })

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: POST_ACTION_NLU_SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.1, // Baja temperatura para respuestas consistentes
      max_tokens: 200,
      response_format: { type: "json_object" }
    })

    const responseText = response.choices[0]?.message?.content || ""
    
    logger.debug("Respuesta de GPT-4o-mini", { responseText })

    const parsed = JSON.parse(responseText)

    logger.info("Clasificación NLU exitosa", {
      intent: parsed.intent,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning
    })

    return {
      intent: parsed.intent as PostActionIntent,
      confidence: parsed.confidence || 0.8,
      reasoning: parsed.reasoning || "Clasificado por NLU",
    }
  } catch (error) {
    logger.error("Error en NLU, usando fallback", error as Error)
    return detectIntentFallback(userMessage)
  }
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

  // Patrones de explicación contextual (por qué canceló/confirmó)
  // Ej: "Está con neumonía", "Me enfermé", "Tengo fiebre", "No puedo ir porque..."
  const explanationPatterns = [
    /\best[aá]\s+(enferm|con|mal|intern)/i,              // "está enfermo", "está con neumonía"
    /\bme\s+enferm[eé]/i,                                // "me enfermé"
    /\btengo?\s+(fiebre|gripe|covid|dolor)/i,            // "tengo fiebre"
    /\bno\s+(?:puede?|va\s+a\s+poder)\s+(?:ir|asistir)/i, // "no puede ir"
    /\bpor(?:que)?\s+(?:est[aá]|tiene?|le\s+pas[oó])/i,  // "porque está...", "porque tiene..."
    /\ble\s+(?:pas[oó]|sali[oó])\s+algo/i,               // "le pasó algo"
    /\btuvo\s+(?:un|una)\s+(?:emergencia|problema)/i,    // "tuvo una emergencia"
    /\bse\s+(?:siente|sinti[oó])\s+mal/i,                // "se siente mal"
    /\bno\s+se\s+siente\s+bien/i,                        // "no se siente bien"
    /\binternado|hospital|urgencia|emergencia/i,         // palabras clave de urgencia
    /\bneumon[ií]a|covid|gripe|fiebre|virus/i,           // enfermedades
    /\baccidente|cirug[ií]a|operaci[oó]n/i,              // eventos médicos
    /\bviaje|viajando|no\s+est[aá]\s+en/i,               // viajes/ausencia
    /\btrabajo|laboral|reuni[oó]n/i,                     // trabajo
    /\bolvid[eé]|me\s+confund[ií]/i,                     // olvido/confusión
    /\bfalleci[oó]|muri[oó]|fallecimiento|muerte/i,      // fallecimiento
    /\bse\s+mud[oó]|cambio\s+de\s+(?:ciudad|domicilio)/i, // mudanza
    /\bcambi[oó]\s+de\s+(?:obra\s+social|prepaga)/i,     // cambio de cobertura
    /\bya\s+no\s+(?:es|va\s+a\s+ser)\s+paciente/i,       // ya no es paciente
  ]

  for (const pattern of explanationPatterns) {
    if (pattern.test(msg)) {
      return {
        intent: "explicacion_contextual",
        confidence: 0.75,
        reasoning: "Detectado patrón de explicación contextual",
      }
    }
  }

  // Patrones de consulta sobre el turno
  const queryPatterns = [
    /\bd[oó]nde\s+(?:es|queda)/i,        // "donde es", "donde queda"
    /\bcu[aá]l\s+es\s+la\s+direcci[oó]n/i, // "cuál es la dirección"
    /\ba\s+qu[eé]\s+hora/i,              // "a qué hora"
    /\bqu[eé]\s+d[ií]a/i,                // "qué día"
    /\bcon\s+qui[eé]n/i,                 // "con quién"
    /\?/,                                 // cualquier pregunta
  ]

  for (const pattern of queryPatterns) {
    if (pattern.test(msg)) {
      return {
        intent: "consulta_turno",
        confidence: 0.7,
        reasoning: "Detectado patrón de consulta sobre turno",
      }
    }
  }

  // Por defecto, asumir explicación contextual para mensajes cortos
  // o consulta para mensajes más largos
  if (msg.length < 50) {
    return {
      intent: "explicacion_contextual",
      confidence: 0.5,
      reasoning: "Mensaje corto post-acción, asumiendo explicación contextual",
    }
  }

  return {
    intent: "consulta_turno",
    confidence: 0.5,
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

// ============================================================================
// SPRINT 17: HANDLER DE CONTEXTO POST-ACCIÓN
// Detecta mensajes contextuales después de una acción (confirmación/cancelación)
// y responde apropiadamente sin reiniciar el flujo
// ============================================================================

export interface PostActionHandlerResult {
  detected: boolean
  intent?: PostActionIntent
  response?: string
  shouldPassToOpenAI?: boolean
  openAIContext?: string
}

/**
 * Detecta si el mensaje es contextual a una acción reciente
 * y determina cómo responder
 * 
 * @returns detected: true si hay contexto post-acción y se procesó
 */
export async function detectPostActionContextPreFlow(
  userMessage: string,
  phoneNumber: string,
  configId: string,
  useNLU: boolean = true
): Promise<PostActionHandlerResult> {
  const logger = createConversationLogger(phoneNumber, configId, "post-action-handler")
  
  // Paso 1: Verificar si hay contexto post-acción
  const context = await getPostActionContext(phoneNumber, configId)
  
  if (!context) {
    logger.debug("No hay contexto post-acción")
    return { detected: false }
  }

  const ageMinutes = Math.round((Date.now() - context.timestamp) / 1000 / 60)
  logger.info("Contexto post-acción encontrado", {
    actionType: context.actionType,
    ageMinutes,
    message: userMessage.substring(0, 50),
  })

  // Paso 2: Detectar intención del mensaje
  let intentResult: PostActionIntentResult

  if (useNLU) {
    intentResult = await detectPostActionIntent(userMessage, context, phoneNumber, configId)
  } else {
    intentResult = detectIntentFallback(userMessage)
  }

  logger.info("Intención detectada", {
    intent: intentResult.intent,
    confidence: intentResult.confidence,
    reasoning: intentResult.reasoning,
  })

  // Paso 3: Procesar según la intención
  switch (intentResult.intent) {
    case "agradecimiento":
      // Responder con despedida empática
      return {
        detected: true,
        intent: intentResult.intent,
        response: buildGratitudeResponse(context),
      }

    case "explicacion_contextual":
      // Responder con empatía a la explicación
      return {
        detected: true,
        intent: intentResult.intent,
        response: buildExplanationResponse(context, userMessage),
      }

    case "consulta_turno":
      // Pasar a OpenAI con el contexto del turno
      return {
        detected: true,
        intent: intentResult.intent,
        shouldPassToOpenAI: true,
        openAIContext: formatPostActionContextForOpenAI(context),
      }

    case "nueva_accion":
      // No interceptar, dejar que continúe el flujo normal
      logger.info("Nueva acción detectada, no interceptar")
      return { detected: false }

    default:
      // Para "otro", pasar a OpenAI con contexto
      return {
        detected: true,
        intent: intentResult.intent,
        shouldPassToOpenAI: true,
        openAIContext: formatPostActionContextForOpenAI(context),
      }
  }
}

/**
 * Construye respuesta empática para agradecimiento post-acción
 */
function buildGratitudeResponse(context: PostActionContext): string {
  const actionMessages = {
    confirmation: "¡Gracias a vos! Te esperamos el día de tu turno.",
    cancellation: "¡Gracias por avisar! Si necesitás algo más, estoy para ayudarte.",
    booking: "¡De nada! Te esperamos el día de tu turno.",
    reschedule: "¡Perfecto! Te esperamos en la nueva fecha.",
  }

  return actionMessages[context.actionType] || "¡Gracias! Si necesitás algo más, estoy para ayudarte."
}

/**
 * Construye respuesta empática para explicaciones contextuales
 * Detecta el tipo de explicación y responde apropiadamente
 */
function buildExplanationResponse(context: PostActionContext, userMessage: string): string {
  const nombre = context.paciente.nombres.split(" ")[0]
  const msg = userMessage.toLowerCase()

  // Detectar casos sensibles específicos
  const isFallecimiento = /falleci[oó]|muri[oó]|fallecimiento|muerte|descans[oó]/.test(msg)
  const isEnfermedad = /enferm|fiebre|covid|gripe|neumoni|intern|hospital|cirug|operaci/.test(msg)
  const isMudanza = /mud[oó]|cambio.*ciudad|cambio.*domicilio/.test(msg)
  const isCambioCobertura = /cambio.*obra.*social|cambio.*prepaga|ya.*no.*paciente/.test(msg)

  if (context.actionType === "cancellation") {
    // Respuestas específicas según el tipo de explicación
    if (isFallecimiento) {
      return `Lamentamos profundamente la pérdida, ${nombre}. Les enviamos nuestras más sinceras condolencias. Si en algún momento necesitan algo, estamos a disposición.`
    }

    if (isEnfermedad) {
      const responses = [
        `Entendemos, ${nombre}. Esperamos que se mejore pronto. Cuando lo necesiten, no duden en contactarnos para agendar un nuevo turno.`,
        `Gracias por contarnos, ${nombre}. Les deseamos una pronta recuperación. Quedamos a disposición para cuando quieran reagendar.`,
        `Entendido, ${nombre}. Lo más importante es la salud. Cuando estén en condiciones, con gusto te ayudo a coordinar un nuevo turno.`,
      ]
      return responses[Math.floor(Math.random() * responses.length)]
    }

    if (isMudanza) {
      return `Entendemos, ${nombre}. Les deseamos lo mejor en esta nueva etapa. Si en algún momento necesitan atención médica en la zona, estamos a disposición.`
    }

    if (isCambioCobertura) {
      return `Entendido, ${nombre}. Gracias por informarnos. Si en algún momento necesitan nuestros servicios nuevamente, con gusto los atendemos.`
    }

    // Respuesta genérica para cancelación
    const genericResponses = [
      `Entendemos, ${nombre}. Gracias por informarnos. Si necesitás algo más, estoy para ayudarte.`,
      `Gracias por contarnos, ${nombre}. Quedamos a disposición para lo que necesites.`,
    ]
    return genericResponses[Math.floor(Math.random() * genericResponses.length)]
  }

  // Para otros tipos de acción
  return `Gracias por contarnos, ${nombre}. Si necesitás algo más, estoy para ayudarte.`
}

/**
 * Exporta el fallback para testing
 */
export { detectIntentFallback as _detectIntentFallback }
