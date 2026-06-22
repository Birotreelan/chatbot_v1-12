import { createConversationLogger } from '../logger'

/**
 * Menu Option Detector - Detecta opciones de menú a partir de texto libre
 * Para el flujo inicial de detección de pacientes
 * VERSIÓN SIMPLIFICADA: Solo keyword matching (sin NLU)
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
    keywords: ['turno', 'cita', 'agendar', 'reserva', 'appointment', 'médico', 'doctor', 'consulta médica'],
  },
  {
    index: 2,
    label: 'Realizar otra consulta',
    keywords: ['consulta', 'pregunta', 'información', 'info', 'duda', 'ayuda', 'soporte', 'help', 'otra'],
  },
]

/**
 * Opciones del menú para pacientes existentes SIN turnos
 * Incluye opcion para solicitar turno para un familiar
 */
export const EXISTING_PATIENT_NO_TURNOS_MENU: MenuOption[] = [
  {
    index: 1,
    label: 'Solicitar turno médico',
    keywords: ['turno', 'cita', 'agendar', 'reserva', 'appointment', 'médico', 'doctor'],
  },
  {
    index: 2,
    label: 'Solicitar turno para un familiar',
    keywords: ['familiar', 'hijo', 'hija', 'esposa', 'esposo', 'madre', 'padre', 'mama', 'mamá', 'papa', 'papá', 'pareja', 'hermano', 'hermana', 'familiar'],
  },
  {
    index: 3,
    label: 'Realizar otra consulta',
    keywords: ['consulta', 'pregunta', 'información', 'duda', 'ayuda'],
  },
]

/**
 * Opciones del menú durante la solicitud de DNI del familiar
 * Solo para detección simple si el usuario escribe texto libre en vez de un DNI
 */
export const FAMILIAR_DNI_MENU: MenuOption[] = [
  {
    index: 0,
    label: 'DNI del familiar',
    keywords: [], // No se usa para keyword matching, solo para contexto
  },
]

/**
 * Opciones del menú para pacientes con 1 turno
 */
export const EXISTING_PATIENT_SINGLE_TURNO_MENU: MenuOption[] = [
  {
    index: 1,
    label: 'Confirmar asistencia al turno médico',
    keywords: ['confirmar', 'si', 'voy', 'asistencia', 'confirm', 'yes', 'iré', 'voy a ir', 'listo'],
  },
  {
    index: 2,
    label: 'Cancelar turno médico',
    keywords: ['cancelar', 'no', 'no voy', 'cancel', 'cancelo', 'no puedo', 'no puedo ir'],
  },
  {
    index: 3,
    label: 'Cancelar el turno médico y solicitar uno nuevo',
    keywords: ['otro', 'nuevo', 'agendar', 'otro turno', 'another', 'más turnos', 'cancelar y', 'cambiar turno', 'reprogramar', 'cancelar otro'],
  },
  {
    index: 4,
    label: 'Realizar otra consulta',
    keywords: ['consulta', 'pregunta', 'información', 'duda', 'ayuda', 'otra consulta', 'otro tema'],
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
    label: 'Cancelar un turno y solicitar uno nuevo',
    keywords: ['otro', 'nuevo', 'agendar', 'otro turno', 'cancelar y', 'cambiar turno', 'reprogramar', 'cancelar otro'],
  },
  {
    index: 4,
    label: 'Realizar otra consulta',
    keywords: ['consulta', 'pregunta', 'información', 'duda', 'ayuda', 'otra consulta', 'otro tema'],
  },
]

/**
 * Detecta qué opción seleccionó el usuario a partir de texto libre
 * Usa SOLO keyword matching para máxima confiabilidad y velocidad
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

  // Keyword matching simple (< 1ms latencia)
  const keywordMatch = detectByKeywords(userMessage, menuOptions)
  
  if (keywordMatch.detected && keywordMatch.confidence >= 0.60) {
    logger.info('Menu option detected by keywords', {
      selectedOption: keywordMatch.selectedOption,
      confidence: keywordMatch.confidence,
      message: userMessage.substring(0, 50),
    })
    return keywordMatch
  }

  logger.info('Menu option NOT detected', {
    message: userMessage.substring(0, 50),
    confidence: keywordMatch.confidence,
  })

  // No detectado - retornar con confidence 0
  return {
    detected: false,
    confidence: 0,
    reasoning: 'No keywords matched with sufficient confidence',
  }
}

/**
 * Detecta opciones usando keyword matching
 * Rápido (< 1ms), altamente confiable
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
      // Buscar palabra clave como palabra completa o substring
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
    // Confianza: base 0.60 + 0.20 por cada keyword matching
    const confidence = Math.min(0.95, 0.60 + bestMatch.matches * 0.15)
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
