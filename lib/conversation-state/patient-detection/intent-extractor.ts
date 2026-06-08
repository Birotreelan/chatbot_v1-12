import { getAssistantResponse } from '../../openai'
import { createConversationLogger } from '../logger'
import { getRedisClient } from '@/lib/redis'

/**
 * Intent Extractor for Initial Contact NLU
 * Usa OpenAI Assistants en lugar de Claude
 * 
 * NLU IDs:
 * - Initial Contact: asst_EJewdsboIdYEnjVyxZsoSCvk
 * - Existing Patient: asst_S4TQH7DmrqPPRbtYTCOd8zYH
 * - New Patient: asst_snnYnxl1CHk8ycNyLGRgYEEI
 */

export interface IntentResult {
  intent: string
  confidence: number
  extracted_data: {
    dni?: string | null
    nombre?: string | null
    obra_social?: string | null
    email?: string | null
    phone?: string | null
  }
  reasoning: string
}

// IDs de los Asistentes NLU de OpenAI
const INITIAL_CONTACT_NLU = 'asst_EJewdsboIdYEnjVyxZsoSCvk'
const EXISTING_PATIENT_NLU = 'asst_S4TQH7DmrqPPRbtYTCOd8zYH'
const NEW_PATIENT_NLU = 'asst_snnYnxl1CHk8ycNyLGRgYEEI'

/**
 * Extrae la intención del mensaje del usuario usando OpenAI Assistants
 */
export async function extractIntent(
  userMessage: string,
  phoneNumber: string,
  clientId: string,
  context: {
    isNewPatient: boolean
    patientName?: string
    patientTurnos?: any[]
  }
): Promise<IntentResult | null> {
  const logger = createConversationLogger(phoneNumber, clientId, 'nlu_processing')

  try {
    logger.info('Extracting intent from message', {
      message: userMessage.substring(0, 50),
      isNewPatient: context.isNewPatient,
    })

    // Seleccionar el asistente NLU correcto según contexto
    const assistantId = selectNLUAssistant(context)

    logger.info('Using NLU Assistant', {
      assistantId,
      isNewPatient: context.isNewPatient,
    })

    // Crear o reutilizar thread para la conversación
    const threadId = await getOrCreateThread(phoneNumber, clientId)

    // Enviar mensaje al asistente NLU
    const response = await getAssistantResponse(threadId, userMessage, assistantId)

    logger.debug('OpenAI Assistant response', {
      response: response.substring(0, 100),
    })

    // Parsear JSON
    const result = JSON.parse(response) as IntentResult

    logger.info('Intent extracted', {
      intent: result.intent,
      confidence: result.confidence,
    })

    return result
  } catch (error) {
    logger.error('Error extracting intent', error as Error)
    return null
  }
}

/**
 * Selecciona el asistente NLU correcto según el contexto del paciente
 */
function selectNLUAssistant(context: {
  isNewPatient: boolean
  patientName?: string
  patientTurnos?: any[]
}): string {
  // Si no sabemos si es paciente nuevo o existente, usar el NLU inicial
  if (context.isNewPatient === undefined) {
    return INITIAL_CONTACT_NLU
  }

  // Si es paciente nuevo, usar el NLU para pacientes nuevos
  if (context.isNewPatient) {
    return NEW_PATIENT_NLU
  }

  // Si es paciente existente, usar el NLU para pacientes existentes
  return EXISTING_PATIENT_NLU
}

/**
 * Obtiene o crea un thread de conversación para el usuario
 */
async function getOrCreateThread(phoneNumber: string, clientId: string): Promise<string> {
  const redis = getRedisClient()
  if (!redis) {
    throw new Error('Redis not available')
  }

  const threadKey = `nlu_thread:${phoneNumber}:${clientId}`

  // Intentar obtener thread existente
  const existingThread = await redis.get(threadKey)
  if (existingThread && typeof existingThread === 'string') {
    return existingThread
  }

  // Si no existe, crear uno nuevo (en getAssistantResponse se crea automáticamente si es necesario)
  // Por ahora, retornamos un ID vacío que será manejado por getAssistantResponse
  return ''
}

/**
 * Determina si un intent requiere procesamiento backend o envío a otro asistente
 */
export function shouldProcessLocally(intent: string): boolean {
  // Intenciones que se pueden procesar en el backend
  const localIntents = [
    'confirm_turn',
    'cancel_turn',
    'dni_submission',
    'farewell',
    'unclear',
  ]

  return localIntents.includes(intent)
}

/**
 * Mapea intención a acción para el backend
 */
export function mapIntentToAction(
  intent: string,
  isNewPatient: boolean
): string {
  const intentMap: Record<string, Record<string, string>> = {
    existing: {
      confirm_turn: 'confirm_appointment',
      cancel_turn: 'cancel_appointment',
      book_new_turn: 'book_new_appointment',
      reschedule_turn: 'reschedule_appointment',
      general_inquiry: 'general_inquiry',
      farewell: 'end_conversation',
      unclear: 'ask_clarification',
    },
    new: {
      dni_submission: 'extract_dni',
      patient_info: 'extract_patient_info',
      pre_registration_question: 'answer_pre_registration',
      abandon: 'end_conversation',
      farewell: 'end_conversation',
      unclear: 'ask_clarification',
    },
  }

  const group = isNewPatient ? 'new' : 'existing'
  return intentMap[group]?.[intent] || 'unknown'
}
