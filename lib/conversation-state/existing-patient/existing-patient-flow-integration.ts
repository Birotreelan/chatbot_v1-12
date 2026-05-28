import { createConversationLogger } from '../logger'
import { getEffectiveFeatureFlags } from '../feature-flags'
import {
  startExistingPatientFlow,
  handleSedeSelection,
  handleTurnSelection,
  handleConfirmation,
  getExistingPatientState,
  isExistingPatientFlowActive,
  clearExistingPatientFlow,
} from './existing-patient-flow-handler'
import {
  buildWelcomeMessage,
  buildEmailRequestMessage,
  buildInvalidEmailMessage,
  buildSedeSelectionMessage,
  buildSearchTypeMessage,
  buildProfessionalSearchMessage,
  buildSpecialtySelectionMessage,
  buildTurnosListMessage,
  buildConfirmationMessage,
  buildSuccessMessage,
  buildErrorMessage,
  buildInvalidSelectionMessage,
  buildNoTurnosMessage,
  buildTooManyAttemptsMessage,
} from './existing-patient-templates'
import { validateEmail } from './existing-patient-validators'

export interface ExistingPatientResult {
  handled: boolean
  message?: string
  action?: string
  nextPhase?: string
  shouldCallOpenAI?: boolean
  openAIContext?: string
}

/**
 * Inicia el flujo de paciente existente
 */
export async function initializeExistingPatientFlow(
  phoneNumber: string,
  patientId: string,
  patientName: string,
  patientDNI: string,
  patientEmail: string | undefined,
  clientId: string
): Promise<ExistingPatientResult> {
  const logger = createConversationLogger(phoneNumber, clientId, 'existing_patient_initial')
  logger.info('Initializing existing patient flow', { patientId })

  const flags = await getEffectiveFeatureFlags(clientId)
  if (!flags.directExistingPatientFlow) {
    logger.debug('Feature flag disabled', {})
    return {
      handled: false,
      shouldCallOpenAI: true,
      openAIContext: 'Use route_to_pacienteExistente',
    }
  }

  try {
    const result = await startExistingPatientFlow(
      patientId,
      patientName,
      patientDNI,
      patientEmail,
      clientId,
      phoneNumber
    )

    if (result.nextPhase === 'awaiting_email') {
      return {
        handled: true,
        message: buildEmailRequestMessage(),
        nextPhase: 'awaiting_email',
      }
    }

    return {
      handled: true,
      message: buildWelcomeMessage(patientName),
      nextPhase: result.nextPhase,
    }
  } catch (error) {
    logger.error('Error initializing flow', error as Error)
    return {
      handled: false,
      shouldCallOpenAI: true,
      openAIContext: 'Error starting existing patient flow',
    }
  }
}

/**
 * Procesa mensaje del usuario durante el flujo
 */
export async function handleExistingPatientMessage(
  phoneNumber: string,
  userMessage: string,
  clientId: string
): Promise<ExistingPatientResult> {
  const logger = createConversationLogger(phoneNumber, clientId, 'existing_patient_message')

  const isActive = await isExistingPatientFlowActive(phoneNumber)
  if (!isActive) {
    return { handled: false, shouldCallOpenAI: true }
  }

  const state = await getExistingPatientState(phoneNumber)
  if (!state) {
    return { handled: false, shouldCallOpenAI: true }
  }

  logger.info('Processing message', { phase: state.phase })

  // Distribuir según fase
  switch (state.phase) {
    case 'awaiting_email':
      return handleEmailInput(phoneNumber, userMessage, clientId, state)

    case 'awaiting_sede':
      return handleSedeInput(phoneNumber, userMessage, clientId, state)

    case 'awaiting_turn_selection':
      return handleTurnoInput(phoneNumber, userMessage, clientId, state)

    case 'awaiting_confirmation':
      return handleConfirmInput(phoneNumber, userMessage, clientId, state)

    default:
      logger.debug('Phase not handled', { phase: state.phase })
      return { handled: false, shouldCallOpenAI: true }
  }
}

/**
 * Maneja input de email
 */
async function handleEmailInput(
  phoneNumber: string,
  userMessage: string,
  clientId: string,
  state: any
): Promise<ExistingPatientResult> {
  const logger = createConversationLogger(phoneNumber, clientId, 'existing_patient_email')

  if (!validateEmail(userMessage.trim())) {
    logger.info('Invalid email', { attempts: state.attempts + 1 })
    state.attempts += 1

    if (state.attempts > 2) {
      return {
        handled: true,
        message: buildTooManyAttemptsMessage(),
        nextPhase: 'abandoned',
      }
    }

    return {
      handled: true,
      message: buildInvalidEmailMessage(state.attempts),
      nextPhase: 'awaiting_email',
    }
  }

  state.patientEmail = userMessage.trim()
  state.phase = 'awaiting_sede'
  state.attempts = 0

  const redis = await import('@/lib/redis').then((m) => m.getRedisClient())
  if (redis) {
    await redis.setex(
      `existing_patient_flow:${phoneNumber}`,
      7200,
      JSON.stringify(state)
    )
  }

  logger.info('Email validated', {})

  return {
    handled: true,
    message: buildSedeSelectionMessage([
      { nombre: 'Centro Principal' },
      { nombre: 'Sucursal Zona Norte' },
      { nombre: 'Sucursal Zona Sur' },
    ]),
    nextPhase: 'awaiting_sede',
  }
}

/**
 * Maneja selección de sede
 */
async function handleSedeInput(
  phoneNumber: string,
  userMessage: string,
  clientId: string,
  state: any
): Promise<ExistingPatientResult> {
  const result = await handleSedeSelection(phoneNumber, userMessage, clientId)

  if (!result.handled) {
    if (result.nextPhase === 'nlu_required') {
      return {
        handled: false,
        shouldCallOpenAI: true,
        openAIContext: 'User message not numeric for sede selection',
      }
    }
    return { handled: false }
  }

  if (result.error) {
    return {
      handled: true,
      message: result.error,
      nextPhase: 'awaiting_sede',
    }
  }

  return {
    handled: true,
    message: buildSearchTypeMessage(),
    nextPhase: result.nextPhase,
  }
}

/**
 * Maneja selección de turno
 */
async function handleTurnoInput(
  phoneNumber: string,
  userMessage: string,
  clientId: string,
  state: any
): Promise<ExistingPatientResult> {
  const result = await handleTurnSelection(phoneNumber, userMessage, clientId)

  if (!result.handled) {
    if (result.nextPhase === 'nlu_required') {
      return {
        handled: false,
        shouldCallOpenAI: true,
        openAIContext: 'User message not numeric for turn selection',
      }
    }
    return { handled: false }
  }

  if (result.error) {
    return {
      handled: true,
      message: result.error,
      nextPhase: 'awaiting_turn_selection',
    }
  }

  const updatedState = await getExistingPatientState(phoneNumber)
  if (!updatedState || !updatedState.selectedTurno) {
    return { handled: false, message: 'Error al procesar selección' }
  }

  return {
    handled: true,
    message: buildConfirmationMessage(updatedState.selectedTurno, updatedState.patientName),
    nextPhase: 'awaiting_confirmation',
  }
}

/**
 * Maneja confirmación final
 */
async function handleConfirmInput(
  phoneNumber: string,
  userMessage: string,
  clientId: string,
  state: any
): Promise<ExistingPatientResult> {
  const result = await handleConfirmation(phoneNumber, userMessage, clientId)

  if (!result.handled) {
    if (result.nextPhase === 'nlu_required') {
      return {
        handled: false,
        shouldCallOpenAI: true,
        openAIContext: 'Ambiguous confirmation message',
      }
    }
    return { handled: false, message: result.error || 'Error procesando confirmación' }
  }

  if (!result.confirmed) {
    if (result.nextPhase === 'initial') {
      return {
        handled: true,
        message: 'Volvamos a comenzar. ¿Cuál es tu preferencia?',
        nextPhase: 'awaiting_sede',
      }
    }
    return { handled: false }
  }

  const updatedState = await getExistingPatientState(phoneNumber)
  if (!updatedState || !updatedState.selectedTurno) {
    return { handled: false, message: 'Error al reservar turno' }
  }

  return {
    handled: true,
    message: buildSuccessMessage(updatedState.selectedTurno),
    action: 'turno_reservado',
    nextPhase: 'completed',
  }
}

/**
 * Verifica si el flujo está activo
 */
export async function shouldUseExistingPatientFlow(
  phoneNumber: string,
  clientId: string
): Promise<boolean> {
  const isActive = await isExistingPatientFlowActive(phoneNumber)
  if (isActive) return true

  const flags = await getEffectiveFeatureFlags(clientId)
  return flags.directExistingPatientFlow
}

/**
 * Completa el flujo
 */
export async function completeExistingPatientFlow(phoneNumber: string): Promise<void> {
  await clearExistingPatientFlow(phoneNumber)
}
