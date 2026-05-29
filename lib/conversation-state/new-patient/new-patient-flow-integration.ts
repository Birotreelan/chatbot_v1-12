import { createConversationLogger } from '../logger'
import { getEffectiveFeatureFlags } from '../feature-flags'
import {
  startNewPatientFlow,
  processNewPatientMessage,
  isNewPatientFlowActive,
  getNewPatientState,
  clearNewPatientFlow,
} from './new-patient-flow-handler'
import {
  buildNameRequestMessage,
  buildHealthInsuranceRequestMessage,
  buildVenueSelectionMessage,
  buildSearchTypeMessage,
  buildTurnsListMessage,
  buildEmailRequestMessage,
  buildConfirmationMessage,
  buildSuccessMessage,
  buildErrorMessage,
} from './new-patient-templates'

/**
 * New Patient Flow Integration
 * API limpia para integrar el flujo de nuevo paciente en whatsapp.tsx
 */

export interface NewPatientResult {
  handled: boolean
  message?: string
  action?: string
  patientInfo?: {
    dni: string
    name?: string
    email?: string
    healthInsurance?: string
  }
  shouldCallOpenAI?: boolean
  openAIContext?: string
}

/**
 * Inicia el flujo de nuevo paciente
 */
export async function initializeNewPatientFlow(
  dni: string,
  phone: string,
  clientId: string
): Promise<NewPatientResult> {
  const logger = createConversationLogger(phone, clientId, 'new_patient_initial')
  logger.info('Initializing new patient flow', { dni })

  const flags = await getEffectiveFeatureFlags(clientId)

  if (!flags.directPacienteNuevo) {
    logger.debug('Feature flag disabled, using OpenAI', {})
    return {
      handled: false,
      shouldCallOpenAI: true,
      openAIContext: 'New patient registration disabled',
    }
  }

  try {
    await startNewPatientFlow(dni, phone, clientId)

    return {
      handled: true,
      message: buildNameRequestMessage(),
      patientInfo: { dni },
    }
  } catch (error) {
    logger.error('Error initializing flow', error as Error)
    return {
      handled: false,
      shouldCallOpenAI: true,
      openAIContext: 'New patient flow error',
    }
  }
}

/**
 * Procesa mensajes durante el flujo de nuevo paciente
 */
export async function handleNewPatientMessage(
  phone: string,
  userMessage: string,
  clientId: string
): Promise<NewPatientResult> {
  const logger = createConversationLogger(phone, clientId, 'new_patient_processing')
  logger.info('Handling new patient message', { message: userMessage.substring(0, 50) })

  const isActive = await isNewPatientFlowActive(phone)

  if (!isActive) {
    logger.debug('Flow not active', { phone })
    return { handled: false, shouldCallOpenAI: true }
  }

  try {
    const state = await getNewPatientState(phone)
    if (!state) {
      return { handled: false, shouldCallOpenAI: true }
    }

    const processResult = await processNewPatientMessage(phone, userMessage, clientId)

    if (!processResult.handled) {
      return {
        handled: false,
        shouldCallOpenAI: true,
        openAIContext: `New patient flow error in phase: ${state.phase}`,
      }
    }

    // Determine message based on next phase
    let responseMessage = ''
    
    switch (processResult.nextPhase) {
      case 'health_insurance':
        responseMessage = buildHealthInsuranceRequestMessage(state.name || 'Paciente')
        break
      case 'venue_selection':
        responseMessage = buildVenueSelectionMessage(state.name || 'Paciente', [])
        break
      case 'search_type':
        responseMessage = buildSearchTypeMessage(state.venueName || 'la sede')
        break
      case 'turn_selection':
        responseMessage = buildTurnsListMessage(state.name || 'Paciente', [])
        break
      case 'email_confirmation':
        responseMessage = buildEmailRequestMessage(state.name || 'Paciente')
        break
      case 'final_confirmation':
        responseMessage = buildConfirmationMessage(
          state.name || 'Paciente',
          state.lastName || '',
          state.dni,
          state.phone,
          state.email || '',
          state.healthInsurance || '',
          {},
          state.selectedTurnNumber || 0
        )
        break
      case 'completed':
        responseMessage = buildSuccessMessage(state.name || 'Paciente')
        break
      default:
        responseMessage = 'Continuando con tu solicitud...'
    }

    return {
      handled: true,
      message: responseMessage,
      action: processResult.nextPhase,
      patientInfo: {
        dni: state.dni,
        name: state.name,
        email: state.email,
        healthInsurance: state.healthInsurance,
      },
    }
  } catch (error) {
    logger.error('Error processing message', error as Error)
    return {
      handled: false,
      shouldCallOpenAI: true,
      openAIContext: 'New patient flow processing error',
    }
  }
}

/**
 * Verifica si debe usar flujo de nuevo paciente
 */
export async function shouldUseNewPatientFlow(
  phone: string,
  clientId: string
): Promise<boolean> {
  const isActive = await isNewPatientFlowActive(phone)
  if (isActive) return true

  const flags = await getEffectiveFeatureFlags(clientId)
  return flags.directPacienteNuevo
}

/**
 * Completa el flujo de nuevo paciente
 */
export async function completeNewPatientFlow(
  phone: string,
  clientId: string
): Promise<void> {
  const logger = createConversationLogger(phone, clientId, 'new_patient_initial')
  logger.info('Completing new patient flow', { phone })

  await clearNewPatientFlow(phone, clientId)
}

/**
 * Obtiene contexto para OpenAI si es necesario
 */
export async function getNewPatientContextForOpenAI(phone: string): Promise<string> {
  const state = await getNewPatientState(phone)

  if (!state) {
    return 'New patient registration - collect DNI and initiate registration'
  }

  let context = `New patient registration in progress (phase: ${state.phase})\n`
  if (state.name) context += `Name: ${state.name}\n`
  if (state.healthInsurance) context += `Health Insurance: ${state.healthInsurance}\n`

  return context
}

// Re-export functions from handler so they can be imported from this module
export { isNewPatientFlowActive, getNewPatientState, clearNewPatientFlow } from './new-patient-flow-handler'
