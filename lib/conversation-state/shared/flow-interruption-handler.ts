/**
 * Handler de Consultas Intercaladas en Flujos Activos
 *
 * Cuando el usuario envía un mensaje de texto libre mientras se espera
 * una selección numérica (sede, especialidad, profesional, turno),
 * este módulo determina si el mensaje es:
 *
 *   A) Una consulta intercalada (precio, dirección, documentación, etc.)
 *      → Responder la consulta + re-mostrar las opciones disponibles.
 *
 *   B) Un intento de selección por texto (nombre de sede, ordinal, etc.)
 *      → Devolver `isInterruption: false` para que el handler original lo procese.
 *
 * Flujo de ejecución:
 *   1. Pre-check determinístico (sin IA): descartar mensajes cortos o claramente
 *      numéricos que ya son manejados por el handler principal.
 *   2. Llamada NLU a GPT-4o-mini para clasificar el intent.
 *   3. Si es consulta intercalada, construir la respuesta + el bloque de opciones.
 */

import { openai } from '@/lib/openai'
import { createConversationLogger } from '../logger'

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type InterruptionContext =
  | 'awaiting_sede'
  | 'awaiting_specialty_selection'
  | 'awaiting_professional_selection'
  | 'awaiting_turno_selection'

export interface FlowInterruptionResult {
  /** true  → es consulta intercalada, se debe responder con `response` */
  isInterruption: boolean
  /** Texto completo a enviar al usuario (respuesta + re-prompt de opciones) */
  response?: string
}

export interface OptionsToResume {
  /** Mensaje original que mostraba las opciones (para re-enviarlo al final) */
  originalPromptMessage: string
}

// ---------------------------------------------------------------------------
// Pre-check: evitar llamadas a IA innecesarias
// ---------------------------------------------------------------------------

/**
 * Retorna true si el mensaje puede ser un intento de selección (no consulta)
 * sin necesidad de llamar a OpenAI.
 */
function looksDeterministicallyLikeSelection(input: string): boolean {
  const trimmed = input.trim()

  // Mensaje vacío
  if (!trimmed) return true

  // Número puro → definitivamente es una selección
  if (/^\d+$/.test(trimmed)) return true

  // Hora pura (09:30, 9.30) → selección de turno
  if (/^\d{1,2}[:.]\d{2}$/.test(trimmed)) return true

  // Mensaje muy corto sin signos de pregunta ni palabras interrogativas
  // Ej: "Haedo", "primer", "el segundo"
  const wordCount = trimmed.split(/\s+/).length
  const hasQuestionMark = trimmed.includes('?')
  const interrogativeWords = /\b(cuanto|cuánto|cuanto cuesta|precio|costo|cómo|como|donde|dónde|qué|que|por qué|porque|cuando|cuándo|quién|quien|puede|puedo|hay|tiene|podría|podria|quisiera|necesito|información|info|me dices|me podés|podrías)\b/i

  if (wordCount <= 3 && !hasQuestionMark && !interrogativeWords.test(trimmed)) {
    return true
  }

  return false
}

// ---------------------------------------------------------------------------
// Llamada NLU
// ---------------------------------------------------------------------------

type NLUIntent =
  | 'selection_attempt'   // Intento de selección de opción
  | 'price_inquiry'       // Pregunta por precio / costo
  | 'location_inquiry'    // Pregunta por dirección / cómo llegar
  | 'documentation_inquiry' // Pregunta por requisitos / documentos
  | 'schedule_inquiry'    // Pregunta por horarios de atención
  | 'coverage_inquiry'    // Pregunta por cobertura / obra social
  | 'cancel_flow'         // Quiere cancelar / ya no quiere turno
  | 'other_inquiry'       // Otra consulta genérica no relacionada

interface NLUResult {
  intent: NLUIntent
  confidence: 'high' | 'medium' | 'low'
  reasoning: string
}

async function classifyInterruptionNLU(
  userMessage: string,
  flowContext: InterruptionContext
): Promise<NLUResult> {
  const contextDesc: Record<InterruptionContext, string> = {
    awaiting_sede: 'el sistema espera que el usuario elija una SEDE (clínica) de una lista numerada',
    awaiting_specialty_selection: 'el sistema espera que el usuario elija una ESPECIALIDAD médica de una lista numerada',
    awaiting_professional_selection: 'el sistema espera que el usuario elija un PROFESIONAL (médico) de una lista numerada',
    awaiting_turno_selection: 'el sistema espera que el usuario elija un TURNO (fecha y hora) de una lista numerada',
  }

  const systemPrompt = `Eres un clasificador de intenciones para un chatbot de agenda médica. 
Tu tarea es determinar si el mensaje del usuario es un INTENTO DE SELECCIÓN de una opción de lista, 
o una CONSULTA INTERCALADA en medio del flujo de agendamiento.

Contexto actual: ${contextDesc[flowContext]}.

Responde SOLO con JSON válido, sin markdown. Formato:
{
  "intent": "<intent>",
  "confidence": "<high|medium|low>",
  "reasoning": "<razón breve en español>"
}

Intents posibles:
- "selection_attempt": el usuario intenta responder eligiendo una opción (nombre de sede, ordinal, número, etc.)
- "price_inquiry": pregunta por precio, costo, valor de la consulta
- "location_inquiry": pregunta por dirección, cómo llegar, dónde queda
- "documentation_inquiry": pregunta por qué documentos traer, requisitos
- "schedule_inquiry": pregunta por horario de atención de la clínica
- "coverage_inquiry": pregunta sobre cobertura, si su obra social cubre, copago
- "cancel_flow": dice que ya no quiere turno, que lo cancela, que no le interesa
- "other_inquiry": cualquier otra consulta no relacionada con elegir una opción`

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.1,
      max_tokens: 150,
    })

    const raw = response.choices[0]?.message?.content
    if (!raw) throw new Error('OpenAI: respuesta vacía')

    const parsed = JSON.parse(raw) as NLUResult
    return parsed
  } catch (error) {
    // En caso de error de parseo o conexión, asumir selection_attempt para no bloquear
    return {
      intent: 'selection_attempt',
      confidence: 'low',
      reasoning: `Error NLU: ${error}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Construcción de respuestas por tipo de consulta
// ---------------------------------------------------------------------------

const CHANNEL_DISCLAIMER =
  `\n\n_Este canal de WhatsApp es exclusivo para la gestión de turnos (solicitar, consultar, confirmar o cancelar turnos)._`

function buildInterruptionResponse(
  intent: NLUIntent,
  escalationPhone?: string,
  resumePrompt?: string
): string {
  const phoneText = escalationPhone
    ? ` Para esa consulta te recomendamos comunicarte directamente con la clínica al *${escalationPhone}*.`
    : ' Para esa consulta te recomendamos comunicarte directamente con la clínica.'

  let responseBody: string

  switch (intent) {
    case 'price_inquiry':
      responseBody =
        `No puedo brindarte información sobre precios o costos de consultas, ya que ese tipo de consultas deben ser respondidas por la clínica.${phoneText}`
      break
    case 'location_inquiry':
      responseBody =
        `La dirección exacta de cada sede la podrás ver una vez que la selecciones en el listado.` +
        (escalationPhone ? ` Para más detalles, comunicate con la clínica al *${escalationPhone}*.` : '')
      break
    case 'documentation_inquiry':
      responseBody =
        `No puedo brindarte información sobre los documentos o requisitos necesarios para la consulta.${phoneText}`
      break
    case 'schedule_inquiry':
      responseBody =
        `No puedo brindarte información sobre los horarios de atención de la clínica.${phoneText}`
      break
    case 'coverage_inquiry':
      responseBody =
        `No puedo brindarte información sobre cobertura o copago de obra social.${phoneText}`
      break
    case 'cancel_flow':
      // Si el usuario quiere cancelar el flujo, no re-mostramos opciones ni disclaimer
      return `Entendido. Podés retomar el agendamiento cuando lo necesites. Hasta luego.`
    case 'other_inquiry':
    default:
      responseBody =
        `No puedo brindarte información sobre eso.${phoneText}`
      break
  }

  // Agregar disclaimer de exclusividad del canal
  responseBody += CHANNEL_DISCLAIMER

  // Agregar el re-prompt del flujo
  const resumeBlock = resumePrompt
    ? `\n\n${resumePrompt}`
    : ''

  return `${responseBody}${resumeBlock}`
}

// ---------------------------------------------------------------------------
// Función principal exportada
// ---------------------------------------------------------------------------

/**
 * Detecta si el mensaje del usuario es una consulta intercalada en medio de un flujo.
 *
 * @param userMessage    Mensaje original del usuario
 * @param flowContext    En qué fase del flujo se encuentra ('awaiting_sede', etc.)
 * @param resumeOptions  Objeto con el mensaje original de opciones para re-mostrar
 * @param escalationPhone Teléfono de derivación de la clínica (opcional)
 * @param phoneNumber    Teléfono del usuario (para logging)
 * @param clientId       ID del cliente (para logging)
 * @returns FlowInterruptionResult
 */
export async function detectFlowInterruption(
  userMessage: string,
  flowContext: InterruptionContext,
  resumeOptions: OptionsToResume,
  escalationPhone?: string,
  phoneNumber?: string,
  clientId?: string
): Promise<FlowInterruptionResult> {
  const logger = createConversationLogger(
    phoneNumber ?? 'unknown',
    clientId ?? 'unknown',
    'flow_interruption'
  )

  // 1. Pre-check determinístico: si parece una selección, no llamar a IA
  if (looksDeterministicallyLikeSelection(userMessage)) {
    logger.info('Pre-check: parece selección, omitir NLU de interrupción', { input: userMessage })
    return { isInterruption: false }
  }

  // 2. Clasificar con NLU
  logger.info('Clasificando posible consulta intercalada con NLU', { input: userMessage, flowContext })

  const nluResult = await classifyInterruptionNLU(userMessage, flowContext)

  logger.info('NLU clasificó intención', {
    intent: nluResult.intent,
    confidence: nluResult.confidence,
    reasoning: nluResult.reasoning,
  })

  // 3. Si el intent es selection_attempt (con confianza alta o media), no es interrupción
  if (
    nluResult.intent === 'selection_attempt' &&
    (nluResult.confidence === 'high' || nluResult.confidence === 'medium')
  ) {
    return { isInterruption: false }
  }

  // 4. Si con baja confianza es selection_attempt, también pasar al handler original
  if (nluResult.intent === 'selection_attempt') {
    return { isInterruption: false }
  }

  // 5. Es una consulta intercalada → construir respuesta
  const response = buildInterruptionResponse(
    nluResult.intent,
    escalationPhone,
    // Para cancel_flow no re-mostramos las opciones
    nluResult.intent === 'cancel_flow' ? undefined : resumeOptions.originalPromptMessage
  )

  logger.info('Consulta intercalada detectada, respondiendo con desvío temporal', {
    intent: nluResult.intent,
    confidence: nluResult.confidence,
  })

  return {
    isInterruption: true,
    response,
  }
}
