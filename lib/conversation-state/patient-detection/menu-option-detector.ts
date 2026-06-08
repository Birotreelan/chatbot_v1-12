import { getAssistantResponse } from '../../openai'
import { createConversationLogger } from '../logger'

/**
 * Menu Option Detector - Detecta opciones de menú a partir de texto libre
 * Para el flujo inicial de detección de pacientes
 * Usa OpenAI Assistants en lugar de Claude
 */

export interface MenuOption {
  index: number
  label: string
  keywords: string[]
}

export interface DetectionResult {
  detected: boolean
  selectedOption?: number
  confidence: number
  reasoning: string
}

/**
 * Opciones del menú inicial para pacientes nuevos
 * "¿Cuál es el motivo de tu contacto?"
 */
export const NEW_PATIENT_MENU: MenuOption[] = [
  {
    index: 1,
    label: 'Solicitar un turno médico',
    keywords: ['turno', 'cita', 'citsación', 'agendar', 'reserva', 'appointment', 'médico', 'doctor'],
  },
  {
    index: 2,
    label: 'Realizar otra consulta',
    keywords: ['consulta', 'pregunta', 'información', 'info', 'duda', 'ayuda', 'soporte', 'help'],
  },
]

/**
 * Opciones del menú para pacientes existentes SIN turnos
 */
export const EXISTING_PATIENT_NO_TURNOS_MENU: MenuOption[] = [
  {
    index: 1,
    label: 'Solicitar turno médico',
    keywords: ['turno', 'cita', 'agendar', 'reserva', 'appointment', 'médico', 'doctor'],
  },
  {
    index: 2,
    label: 'Realizar otra consulta',
    keywords: ['consulta', 'pregunta', 'información', 'duda', 'ayuda'],
  },
]

/**
 * Opciones del menú para pacientes con 1 turno
 */
export const EXISTING_PATIENT_SINGLE_TURNO_MENU: MenuOption[] = [
  {
    index: 1,
    label: 'Confirmar asistencia al turno médico',
    keywords: ['confirmar', 'si', 'voy', 'asistencia', 'confirm', 'yes', 'iré'],
  },
  {
    index: 2,
    label: 'Cancelar turno médico',
    keywords: ['cancelar', 'no', 'no voy', 'cancel', 'cancelo', 'no puedo'],
  },
  {
    index: 3,
    label: 'Solicitar otro turno médico',
    keywords: ['otro', 'nuevo', 'turno', 'agendar', 'otro turno', 'another'],
  },
]

/**
 * Opciones del menú para pacientes con múltiples turnos
 */
export const EXISTING_PATIENT_MULTIPLE_TURNOS_MENU: MenuOption[] = [
  {
    index: 1,
    label: 'Confirmar asistencia a un turno',
    keywords: ['confirmar', 'si', 'voy', 'asistencia', 'confirm', 'yes'],
  },
  {
    index: 2,
    label: 'Cancelar un turno',
    keywords: ['cancelar', 'no', 'no voy', 'cancel', 'cancelo'],
  },
  {
    index: 3,
    label: 'Solicitar otro turno médico',
    keywords: ['otro', 'nuevo', 'turno', 'agendar', 'otro turno'],
  },
]

// ID del Asistente NLU de OpenAI para detección de opciones
const MENU_OPTION_NLU_ASSISTANT_ID = 'asst_EJewdsboIdYEnjVyxZsoSCvk'

/**
 * Detecta qué opción seleccionó el usuario a partir de texto libre
 * Usa 2 estrategias: keyword matching + NLU (OpenAI Assistant)
 *
 * @param userMessage Mensaje del usuario
 * @param menuOptions Opciones disponibles del menú
 * @param phoneNumber Número de teléfono (para logging)
 * @returns Resultado de detección con opción seleccionada o confidence 0
 */
export async function detectMenuOption(
  userMessage: string,
  menuOptions: MenuOption[],
  phoneNumber: string
): Promise<DetectionResult> {
  const logger = createConversationLogger(phoneNumber, '', 'menu-option-detection')

  // Estrategia 1: Keyword matching simple (0ms latencia)
  const keywordMatch = detectByKeywords(userMessage, menuOptions)
  if (keywordMatch.detected && keywordMatch.confidence >= 0.85) {
    logger.info('Menu option detected by keywords', {
      selectedOption: keywordMatch.selectedOption,
      confidence: keywordMatch.confidence,
    })
    return keywordMatch
  }

  // Estrategia 2: NLU con OpenAI (200ms latencia)
  try {
    const nluResult = await detectWithNLU(userMessage, menuOptions, phoneNumber)
    if (nluResult.detected && nluResult.confidence >= 0.70) {
      logger.info('Menu option detected by NLU', {
        selectedOption: nluResult.selectedOption,
        confidence: nluResult.confidence,
      })
      return nluResult
    }
  } catch (error) {
    logger.warn('NLU detection failed, falling back to keyword match', {
      error: String(error),
    })
  }

  // Retornar keyword match con confianza baja o no detectado
  return keywordMatch
}

/**
 * Detecta opciones usando keyword matching
 * Rápido (0ms), pero con falsos negativos en texto natural
 */
function detectByKeywords(
  userMessage: string,
  menuOptions: MenuOption[]
): DetectionResult {
  const normalizedMessage = userMessage.toLowerCase().trim()

  // Buscar coincidencias de palabras clave
  let bestMatch: { option: MenuOption; matches: number } | null = null

  for (const option of menuOptions) {
    let matches = 0
    for (const keyword of option.keywords) {
      // Buscar palabra clave completa o como substring
      if (normalizedMessage.includes(keyword)) {
        matches++
      }
    }

    if (matches > 0) {
      if (!bestMatch || matches > bestMatch.matches) {
        bestMatch = { option, matches }
      }
    }
  }

  if (bestMatch) {
    const confidence = Math.min(0.95, 0.5 + bestMatch.matches * 0.15)
    return {
      detected: true,
      selectedOption: bestMatch.option.index,
      confidence,
      reasoning: `Keyword match (${bestMatch.matches} keywords)`,
    }
  }

  return {
    detected: false,
    confidence: 0,
    reasoning: 'No keywords matched',
  }
}

/**
 * Detecta opciones usando OpenAI Assistants NLU
 * Más preciso pero más lento (200ms)
 */
async function detectWithNLU(
  userMessage: string,
  menuOptions: MenuOption[],
  phoneNumber: string
): Promise<DetectionResult> {
  const logger = createConversationLogger(phoneNumber, '', 'menu-option-nlu')

  try {
    // Preparar el mensaje para el asistente
    const assistantMessage = buildNLUMessage(userMessage, menuOptions)

    // Crear o reutilizar thread
    const threadId = ''  // getAssistantResponse maneja la creación automática

    // Llamar al asistente NLU
    const response = await getAssistantResponse(threadId, assistantMessage, MENU_OPTION_NLU_ASSISTANT_ID)

    logger.debug('OpenAI NLU response', {
      response: response.substring(0, 100),
    })

    // Parsear JSON de respuesta
    const result = JSON.parse(response)

    if (result.selected_option && result.confidence >= 0.70) {
      return {
        detected: true,
        selectedOption: result.selected_option,
        confidence: result.confidence,
        reasoning: result.reasoning || 'OpenAI NLU detection',
      }
    }

    return {
      detected: false,
      confidence: result.confidence || 0,
      reasoning: result.reasoning || 'OpenAI NLU confidence too low',
    }
  } catch (error) {
    logger.error('NLU detection failed', error as Error)
    throw new Error(`NLU detection failed: ${String(error)}`)
  }
}

/**
 * Construye el mensaje para el asistente NLU de OpenAI
 */
function buildNLUMessage(userMessage: string, menuOptions: MenuOption[]): string {
  const optionsText = menuOptions
    .map((opt) => `${opt.index}. ${opt.label}`)
    .join('\n')

  return `Menú disponible:
${optionsText}

El usuario dice: "${userMessage}"

Responde con JSON indicando qué opción seleccionó:
{
  "selected_option": 1,
  "confidence": 0.95,
  "reasoning": "Razón breve"
}`
}
