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
import { obtenerTodasLasSedes } from '../../api-tools/api-functions'

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
 * FLUJO CORRECTO: Sedes primero, email DESPUES de seleccionar turno
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
  if (!flags.directPacienteExistente) {
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

    // El flujo ahora siempre empieza en awaiting_sede
    // Debemos obtener las sedes de la API y mostrarlas junto con el mensaje de bienvenida
    if (result.nextPhase === 'awaiting_sede') {
      try {
        const sedesResult = await obtenerTodasLasSedes(clientId)
        
        if (sedesResult.success && sedesResult.sedes && sedesResult.sedes.length > 0) {
          // Mapear sedes al formato esperado por el template
          const sedesFormateadas = sedesResult.sedes.map((sede) => ({
            id: sede.Id,
            nombre: sede.Nombre_Completo,
            domicilio: sede.Domicilio,
            localidad: sede.Localidad,
            provincia: sede.Provincia,
          }))
          
          // Guardar las opciones de sedes en el estado para referencia posterior
          const redis = await import('@/lib/redis').then((m) => m.getRedisClient())
          if (redis) {
            const stateKey = `existing_patient_flow:${phoneNumber}`
            const stateStr = await redis.get(stateKey)
            if (stateStr) {
              const state = typeof stateStr === 'object' ? stateStr : JSON.parse(stateStr as string)
              state.sedesOpciones = sedesFormateadas
              await redis.setex(stateKey, 7200, JSON.stringify(state))
            }
          }
          
          logger.info('Sedes obtenidas desde API para inicializacion', { total: sedesFormateadas.length })
          
          // Construir mensaje de bienvenida + sedes
          const welcomeMessage = buildWelcomeMessage(patientName)
          const sedesMessage = buildSedeSelectionMessage(sedesFormateadas)
          
          return {
            handled: true,
            message: `${welcomeMessage}\n\n${sedesMessage}`,
            nextPhase: 'awaiting_sede',
          }
        } else {
          logger.warn('No se pudieron obtener sedes desde la API en inicializacion', { error: sedesResult.error })
          return {
            handled: true,
            message: `${buildWelcomeMessage(patientName)}\n\nNo pude obtener las sedes disponibles en este momento. Por favor, comunicate directamente con la clinica.`,
            nextPhase: 'error',
          }
        }
      } catch (error) {
        logger.error('Error obteniendo sedes en inicializacion', error as Error)
        return {
          handled: true,
          message: `${buildWelcomeMessage(patientName)}\n\nOcurrio un error al obtener las sedes. Por favor, intenta nuevamente mas tarde.`,
          nextPhase: 'error',
        }
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

  // Obtener sedes reales desde la API
  try {
    const sedesResult = await obtenerTodasLasSedes(clientId)
    
    if (sedesResult.success && sedesResult.sedes && sedesResult.sedes.length > 0) {
      // Mapear sedes al formato esperado por el template
      const sedesFormateadas = sedesResult.sedes.map((sede) => ({
        id: sede.Id,
        nombre: sede.Nombre_Completo,
        domicilio: sede.Domicilio,
        localidad: sede.Localidad,
        provincia: sede.Provincia,
      }))
      
      // Guardar las opciones de sedes en el estado para referencia posterior
      state.sedesOpciones = sedesFormateadas
      if (redis) {
        await redis.setex(
          `existing_patient_flow:${phoneNumber}`,
          7200,
          JSON.stringify(state)
        )
      }
      
      logger.info('Sedes obtenidas desde API', { total: sedesFormateadas.length })
      
      return {
        handled: true,
        message: buildSedeSelectionMessage(sedesFormateadas),
        nextPhase: 'awaiting_sede',
      }
    } else {
      logger.warn('No se pudieron obtener sedes desde la API', { error: sedesResult.error })
      return {
        handled: true,
        message: 'No pude obtener las sedes disponibles en este momento. Por favor, comunicate directamente con la clinica.',
        nextPhase: 'error',
      }
    }
  } catch (error) {
    logger.error('Error obteniendo sedes', error as Error)
    return {
      handled: true,
      message: 'Ocurrio un error al obtener las sedes. Por favor, intenta nuevamente mas tarde.',
      nextPhase: 'error',
    }
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
  return flags.directPacienteExistente
}

/**
 * Completa el flujo
 */
export async function completeExistingPatientFlow(phoneNumber: string): Promise<void> {
  await clearExistingPatientFlow(phoneNumber)
}

// Re-export isExistingPatientFlowActive para que pueda ser importado desde este módulo
export { isExistingPatientFlowActive } from './existing-patient-flow-handler'
