/**
 * Sprint 18: NLU Fallback Router Inteligente
 *
 * Cuando ningún handler específico (regex puro) detecta intención con alta confianza,
 * este handler NLU actúa como "fallback inteligente" para clasificar la intención real
 * del usuario y redirigirlo al flujo correcto.
 *
 * Casos de uso:
 * 1. "Si estaré ede dia" → Detectado como FECHA_QUERY (false positive) → NLU reclasifica como CONFIRMAR_ASISTENCIA
 * 2. "Buenas tardes estuve 3 dias tratando..." → Detectado como FECHA_QUERY → NLU reclasifica como QUEJA_FRUSTRACION
 * 3. "Sobre todo por si alguna persona..." → No matchea nada → NLU clasifica como EXPLICACION_CONTEXTUAL
 *
 * Orden de llamada en whatsapp.tsx:
 * Sprint 15 → Sprint 14 → Sprint 16 → Sprint 17 → Sprint 12 → Sprint 13 → ★ SPRINT 18 NLU FALLBACK ★ → Sprint 9a
 */

import { createConversationLogger } from "./logger"
import { getRedisClient } from "@/lib/redis"
import { openai } from "@/lib/openai"

const logger = createConversationLogger("nlu-fallback-handler")

// ============================================================================
// TIPOS
// ============================================================================

export type FallbackIntent =
  | "confirmar_asistencia"      // "Si estaré ese dia", "ahi voy", "la confirmo"
  | "cancelar_turno"            // "no puedo ir", "tengo que cancelar"
  | "reagendar_turno"           // "quiero cambiar el turno", "otra fecha"
  | "consulta_informativa"      // "¿donde queda?", "¿a que hora?"
  | "queja_frustracion"         // "estuve 3 dias llamando...", "nunca atienden"
  | "explicacion_contextual"    // "Esta con neumonia", "por motivos de salud"
  | "saludo_despedida"          // "gracias", "chau", "igualmente"
  | "numero_equivocado"         // "no soy esa persona", "se equivocaron"
  | "otro"                      // → Continuar al flujo normal

export interface FallbackIntentResult {
  intent: FallbackIntent
  confidence: number
  reasoning: string
  response?: string  // Respuesta empática generada por GPT
  action?: {
    type: "direct_confirmation" | "direct_cancellation" | "show_menu" | "continue_flow"
    data?: Record<string, any>
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

/**
 * Main fallback handler: cuando ningún regex matchea con alta confianza,
 * usa NLU para clasificar la intención real del usuario
 *
 * Retorna:
 * - { shouldHandle: true, ...result } → Handler debe procesar el mensaje
 * - { shouldHandle: false } → No aplica, continuar con flujo normal
 */
export async function detectNLUFallbackPreFlow(
  userPhoneNumber: string,
  userMessage: string,
  configId: string,
  appointmentContext?: any,
  conversationHistory?: string,
): Promise<{
  shouldHandle: boolean
  result?: FallbackIntentResult
  response?: string
}> {
  try {
    // ¡IMPORTANTE! Solo procesar si:
    // 1. Hay appointmentContext activo (hay un turno reciente)
    // 2. El mensaje es texto libre (no un número o patrón muy simple)
    if (!appointmentContext) {
      return { shouldHandle: false }
    }

    if (userMessage.length < 5 || /^\d+$/.test(userMessage.trim())) {
      return { shouldHandle: false }
    }

    logger.info(`[Sprint 18] Clasificando mensaje con NLU fallback`, {
      userMessage,
      hasAppointmentContext: !!appointmentContext,
    })

    const classificationResult = await classifyIntentWithNLU(
      userMessage,
      appointmentContext,
      conversationHistory,
    )

    logger.info(`[Sprint 18] Clasificación NLU completada`, classificationResult)

    // Si confidence es baja, no procesamos
    if (classificationResult.confidence < 0.6) {
      logger.info(`[Sprint 18] Confidence bajo (${classificationResult.confidence}), continuar con flujo normal`)
      return { shouldHandle: false }
    }

    // Si es "otro", no procesamos
    if (classificationResult.intent === "otro") {
      return { shouldHandle: false }
    }

    // Si es confirmación → activar acción directa de confirmación
    if (classificationResult.intent === "confirmar_asistencia") {
      const response = buildConfirmationResponse(appointmentContext)
      return {
        shouldHandle: true,
        result: classificationResult,
        response,
      }
    }

    // Si es cancelación → mostrar menú para confirmar cancelación
    if (classificationResult.intent === "cancelar_turno") {
      const response = buildMenuResponse(appointmentContext, classificationResult.response)
      return {
        shouldHandle: true,
        result: classificationResult,
        response,
      }
    }

    // Si es reagendar → mostrar menú
    if (classificationResult.intent === "reagendar_turno") {
      const response = buildMenuResponse(appointmentContext, classificationResult.response)
      return {
        shouldHandle: true,
        result: classificationResult,
        response,
      }
    }

    // Si es queja/frustración → respuesta empática de GPT + menú estándar
    if (classificationResult.intent === "queja_frustracion") {
      const response = buildMenuResponse(appointmentContext, classificationResult.response)
      return {
        shouldHandle: true,
        result: classificationResult,
        response,
      }
    }

    // Si es explicación contextual → respuesta empática de GPT + menú estándar
    if (classificationResult.intent === "explicacion_contextual") {
      const response = buildMenuResponse(appointmentContext, classificationResult.response)
      return {
        shouldHandle: true,
        result: classificationResult,
        response,
      }
    }

    // Otros casos: devolver que se debe manejar pero sin respuesta (para que continue normal)
    return { shouldHandle: false }
  } catch (error) {
    logger.error(`[Sprint 18] Error en NLU fallback:`, { error })
    return { shouldHandle: false }
  }
}

// ============================================================================
// NLU CLASSIFICATION
// ============================================================================

/**
 * Usa Chat Completions con GPT-4o-mini para clasificar intención
 * Retorna JSON con intención, confidence y reasoning
 */
async function classifyIntentWithNLU(
  userMessage: string,
  appointmentContext: any,
  conversationHistory?: string,
): Promise<FallbackIntentResult> {
  const systemPrompt = buildSystemPrompt()
  const userPrompt = buildUserPrompt(userMessage, appointmentContext, conversationHistory)

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1, // Consistencia: queremos clasificación determinística
      max_tokens: 500,
    })

    const responseText = response.choices[0]?.message?.content
    if (!responseText) {
      throw new Error("No response from OpenAI")
    }

    const parsed = JSON.parse(responseText) as FallbackIntentResult
    return parsed
  } catch (error) {
    logger.error(`[Sprint 18] Error en classificación NLU:`, { error })
    // Fallback a regex simple si falla NLU
    return classifyIntentWithRegex(userMessage)
  }
}

/**
 * Fallback a regex simple si falla NLU
 */
function classifyIntentWithRegex(userMessage: string): FallbackIntentResult {
  const msg = userMessage.toLowerCase().trim()

  // Confirmación
  if (/\b(confirmo|confirmado|voy|iré|ire|ahi estare|ahí estaré|de acuerdo|ok|dale|listo|si|sí|asistiré|asisto)\b/.test(msg)) {
    return {
      intent: "confirmar_asistencia",
      confidence: 0.7,
      reasoning: "Regex fallback: patrones de confirmación detectados",
    }
  }

  // Cancelación
  if (/\b(cancelo|cancelado|no puedo|no voy|no asistiré|no ire|no iré|no pueda)\b/.test(msg)) {
    return {
      intent: "cancelar_turno",
      confidence: 0.7,
      reasoning: "Regex fallback: patrones de cancelación detectados",
    }
  }

  // Queja
  if (/\b(nunca|imposible|intenté|intente|estuve|3 dias|tres dias|no atienden|nunca me|difícil|dificil)\b/.test(msg)) {
    return {
      intent: "queja_frustracion",
      confidence: 0.6,
      reasoning: "Regex fallback: patrones de queja detectados",
    }
  }

  return {
    intent: "otro",
    confidence: 0.3,
    reasoning: "Regex fallback: no se detectó patrón claro",
  }
}

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

function buildSystemPrompt(): string {
  return `Eres un clasificador de intenciones para un chatbot médico de WhatsApp.

Tu tarea es analizar mensajes de pacientes y:
1. Clasificar su intención en una categoría
2. Generar una respuesta empática y contextualizada (1-2 oraciones máximo)

**CATEGORÍAS DE INTENCIÓN:**

1. **confirmar_asistencia**: El paciente confirma que asistirá al turno
   - Ejemplos: "Si estaré ese día", "Ahi voy", "Dale, allá estaré", "La confirmo"
   - IMPORTANTE: Aunque tenga typos ("Si estaré ede dia"), si la intención es confirmar, clasificar así

2. **cancelar_turno**: El paciente quiere cancelar el turno
   - Ejemplos: "No puedo ir", "Cancelo", "Tengo que cancelar"

3. **reagendar_turno**: El paciente quiere cambiar la fecha/hora
   - Ejemplos: "Quiero cambiar el turno", "Otra fecha", "En otro horario"

4. **consulta_informativa**: El paciente pregunta por detalles del turno
   - Ejemplos: "¿Donde queda?", "¿A qué hora es?", "¿Con quién es?"

5. **queja_frustracion**: El paciente expresa frustración o queja
   - Ejemplos: "Estuve 3 días tratando de llamar", "Nunca me atendieron"
   - Respuesta debe ser empática y pedir disculpas

6. **explicacion_contextual**: El paciente explica un motivo (enfermedad, mudanza, etc.)
   - Ejemplos: "Está con neumonía", "Se mudó", "Cambié de obra social", "Por motivos de salud"
   - Respuesta debe ser empática y comprensiva

7. **saludo_despedida**: El paciente se despide o saluda
   - Ejemplos: "Gracias", "Chau", "Igualmente"

8. **numero_equivocado**: No es la persona buscada
   - Ejemplos: "Se equivocaron", "No soy esa persona"

9. **otro**: No encaja en ninguna categoría

**INSTRUCCIONES PARA LA RESPUESTA:**
- Para "queja_frustracion": Pedir disculpas sinceras por los inconvenientes, mostrar empatía
- Para "explicacion_contextual": Mostrar comprensión y empatía por la situación
- Para "cancelar_turno" o "reagendar_turno": Confirmar que entendiste su necesidad
- La respuesta debe ser breve (1-2 oraciones), cálida y profesional
- NO incluir el menú de opciones en la respuesta (eso se agrega después)
- NO incluir información del turno en la respuesta (eso se agrega después)

**SALIDA JSON:**
{
  "intent": "confirmar_asistencia" | "cancelar_turno" | "reagendar_turno" | "consulta_informativa" | "queja_frustracion" | "explicacion_contextual" | "saludo_despedida" | "numero_equivocado" | "otro",
  "confidence": 0.0-1.0,
  "reasoning": "Explicación breve",
  "response": "Respuesta empática contextualizada (solo para queja_frustracion, explicacion_contextual, cancelar_turno, reagendar_turno)"
}`
}

function buildUserPrompt(
  userMessage: string,
  appointmentContext: any,
  conversationHistory?: string,
): string {
  const appointmentInfo = appointmentContext
    ? `Turno activo:
- Fecha: ${appointmentContext.fecha}
- Hora: ${appointmentContext.hora}
- Profesional: ${appointmentContext.profesional}
- Sede: ${appointmentContext.sede}
- Dirección: ${appointmentContext.direccion || "No disponible"}
`
    : "No hay turno activo"

  const history = conversationHistory
    ? `Historial reciente de conversación:
${conversationHistory}

`
    : ""

  return `${history}${appointmentInfo}

Mensaje del paciente a clasificar:
"${userMessage}"

Clasifica la intención y retorna JSON.`
}

// ============================================================================
// RESPONSE BUILDERS
// ============================================================================

/**
 * Menú estándar de opciones (consistente con el resto del sistema)
 */
const MENU_OPCIONES = `¿En qué te podemos ayudar?

1- Confirmar asistencia al turno médico
2- Cancelar el turno médico
3- Solicitar otro turno médico

Respondé con el número de opción que prefieras.`

/**
 * Respuesta para confirmación directa (sin menú)
 */
function buildConfirmationResponse(appointmentContext: any): string {
  const fecha = formatDate(appointmentContext.appointment_date || appointmentContext.fecha)
  const hora = appointmentContext.appointment_time || appointmentContext.hora
  const profesional = appointmentContext.profesional || appointmentContext.professional_name
  const sede = appointmentContext.sede || appointmentContext.sede_name

  return `Perfecto, tu confirmación de asistencia fue recibida. Te esperamos el *${fecha}* a las *${hora}* con ${profesional} en la sede ${sede}.

Si necesitás algo más, no dudes en escribirme.`
}

/**
 * Respuesta empática (de GPT) + menú estándar
 * Usada para: queja_frustracion, explicacion_contextual, cancelar_turno, reagendar_turno
 */
function buildMenuResponse(appointmentContext: any, gptResponse?: string): string {
  const fecha = formatDate(appointmentContext.appointment_date || appointmentContext.fecha)
  const hora = appointmentContext.appointment_time || appointmentContext.hora
  const profesional = appointmentContext.profesional || appointmentContext.professional_name
  const sede = appointmentContext.sede || appointmentContext.sede_name

  // Usar respuesta de GPT si existe, sino usar fallback
  const empaticResponse = gptResponse || "Entendemos tu situación."

  return `${empaticResponse}

Veo que tenés un turno programado para el *${fecha}* a las *${hora}* con ${profesional} en ${sede}.

${MENU_OPCIONES}`
}

// ============================================================================
// HELPERS
// ============================================================================

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    const options: Intl.DateTimeFormatOptions = {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }
    return date.toLocaleDateString("es-ES", options)
  } catch {
    return dateStr
  }
}
