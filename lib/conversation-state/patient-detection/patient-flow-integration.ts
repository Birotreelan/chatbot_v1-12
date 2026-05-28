import { createConversationLogger } from '../logger'
import { getEffectiveFeatureFlags } from '../feature-flags'
import {
  startPatientDetectionFlow,
  processPatientDetectionMessage,
  isPatientDetectionFlowActive,
  getDetectedPatientInfo,
  clearPatientDetectionFlow,
} from './patient-flow-handler'
import {
  buildExistingPatientGreeting,
  buildNewPatientGreeting,
  buildSelectionConfirmation,
  buildInvalidSelectionMessage,
  buildDetectionErrorMessage,
  buildTurnosSummary,
} from './patient-templates'
import { extractIntent, mapIntentToAction } from './intent-extractor'

/**
 * Patient Detection Flow Integration
 * API limpia para integrar el flujo de detección en whatsapp.tsx
 * Maneja decisiones entre flujo determinístico vs OpenAI
 */

export interface PatientDetectionResult {
  handled: boolean
  message?: string
  action?: string
  patientInfo?: {
    isNewPatient: boolean
    patientId?: string
    patientName?: string
    turnos?: any[]
  }
  shouldCallOpenAI?: boolean
  openAIContext?: string
}

/**
 * Punto de entrada principal: Iniciar detección de paciente
 * Se llama cuando el usuario escribe SIN recordatorio previo
 */
export async function initializePatientDetection(
  phoneNumber: string,
  clientId: string
): Promise<PatientDetectionResult> {
  const logger = createConversationLogger(phoneNumber, clientId, 'initial_detection_pending')
  logger.info('Initializing patient detection', {})

  // Verificar si el feature flag está habilitado
  const flags = await getEffectiveFeatureFlags(clientId)

  if (!flags.directPatientDetection) {
    logger.debug('Feature flag disabled, using OpenAI', {})
    return {
      handled: false,
      shouldCallOpenAI: true,
      openAIContext: 'Patient detection disabled, route to asst_router',
    }
  }

  try {
    const detectionResult = await startPatientDetectionFlow(phoneNumber, clientId)

    if (detectionResult.error) {
      logger.warn('Detection error, fallback to OpenAI', {
        error: detectionResult.error,
      })
      return {
        handled: true,
        message: buildDetectionErrorMessage(),
        shouldCallOpenAI: true,
        openAIContext: 'Patient detection error, request DNI',
      }
    }

    if (detectionResult.isNewPatient) {
      logger.info('New patient detected', { phone: phoneNumber })
      return {
        handled: true,
        message: buildNewPatientGreeting(),
        patientInfo: {
          isNewPatient: true,
        },
      }
    }

    // Paciente existente: mostrar saludo con turnos
    const greeting = buildExistingPatientGreeting(
      detectionResult.patientName || 'Paciente',
      detectionResult.turnos || []
    )

    return {
      handled: true,
      message: greeting,
      patientInfo: {
        isNewPatient: false,
        patientId: detectionResult.patientId,
        patientName: detectionResult.patientName,
        turnos: detectionResult.turnos,
      },
    }
  } catch (error) {
    logger.error('Unexpected error', error as Error)

    return {
      handled: false,
      shouldCallOpenAI: true,
      openAIContext: 'Patient detection error, use asst_router',
    }
  }
}

/**
 * Procesa mensajes del usuario durante el flujo de detección
 * Se llama para cada mensaje mientras el flujo está activo
 */
export async function handlePatientDetectionMessage(
  phoneNumber: string,
  userMessage: string,
  clientId: string
): Promise<PatientDetectionResult> {
  const logger = createConversationLogger(phoneNumber, clientId, 'initial_detection_awaiting_action')
  logger.info('Handling patient detection message', {
    message: userMessage.substring(0, 50),
  })

  // Verificar si el flujo está activo
  const isActive = await isPatientDetectionFlowActive(phoneNumber)

  if (!isActive) {
    logger.debug('Flow not active for this user', { phone: phoneNumber })
    return { handled: false, shouldCallOpenAI: true }
  }

  // Procesar mensaje
  const processResult = await processPatientDetectionMessage(
    phoneNumber,
    userMessage,
    clientId
  )

  if (!processResult.handled) {
    // Mensaje no numérico o requiere NLU
    logger.info('Message requires NLU processing', {
      nextPhase: processResult.nextPhase,
    })

    // Preparar contexto para OpenAI
    const patientInfo = await getDetectedPatientInfo(phoneNumber)

    let openAIContext = ''
    if (patientInfo) {
      if (patientInfo.isNewPatient) {
        openAIContext =
          'User is a new patient, waiting for DNI. Extract DNI from message.'
      } else {
        openAIContext = `User is an existing patient (${patientInfo.patientName}). ` +
          `They have ${patientInfo.turnos?.length || 0} turns. ` +
          `Help with: confirming, canceling, or booking a turn.`
      }
    }

    return {
      handled: false,
      shouldCallOpenAI: true,
      openAIContext,
    }
  }

  // Mensaje procesado como selección numérica válida
  logger.info('Valid selection processed', {
    action: processResult.action,
  })

  const message = buildSelectionConfirmation(
    extractNumberFromMessage(userMessage),
    processResult.data?.patientName
  )

  return {
    handled: true,
    message,
    action: processResult.action,
    patientInfo: processResult.data,
  }
}

/**
 * Verifica si debe usar detección de paciente
 * Útil para decidir en whatsapp.tsx si procesar localmente o enviar a OpenAI
 */
export async function shouldUsePatientDetection(
  phoneNumber: string,
  clientId: string,
  isReminderPending: boolean
): Promise<boolean> {
  // No usar si hay recordatorio pendiente (usa otro flujo)
  if (isReminderPending) {
    return false
  }

  // Verificar si el flujo ya está activo para este usuario
  const isActive = await isPatientDetectionFlowActive(phoneNumber)

  if (isActive) {
    return true
  }

  // Verificar si el feature flag está habilitado
  const flags = await getEffectiveFeatureFlags(clientId)

  return flags.directPatientDetection
}

/**
 * Limpia la detección cuando el usuario termina el flujo
 */
export async function completePatientDetectionFlow(
  phoneNumber: string,
  clientId: string
): Promise<void> {
  const logger = createConversationLogger(phoneNumber, clientId, 'initial_detection_pending')
  logger.info('Completing patient detection flow', { phone: phoneNumber })

  await clearPatientDetectionFlow(phoneNumber, clientId)
}

/**
 * Helper: Extrae número de 1-4 del mensaje
 */
function extractNumberFromMessage(message: string): number {
  const match = message.trim().match(/^[1-4]$/)
  return match ? parseInt(match[0], 10) : 0
}

/**
 * Obtiene información del paciente detectado para contexto
 */
export async function getPatientContextForOpenAI(
  phoneNumber: string
): Promise<string> {
  const patientInfo = await getDetectedPatientInfo(phoneNumber)

  if (!patientInfo) {
    return ''
  }

  if (patientInfo.isNewPatient) {
    return 'CONTEXTO: Usuario es nuevo en el sistema. Necesitas extraer su DNI.'
  }

  let context = `CONTEXTO: Usuario es paciente existente.\n`
  context += `Nombre: ${patientInfo.patientName}\n`
  context += `DNI: ${patientInfo.patientDNI}\n`

  if (patientInfo.turnos && patientInfo.turnos.length > 0) {
    context += `Turnos: ${patientInfo.turnos.length} agendados\n`
    context += `Próximo: ${patientInfo.turnos[0].fecha}\n`
  }

  return context
}

/**
 * Procesa mensaje con NLU para extraer intención
 */
export async function processMessageWithNLU(
  phoneNumber: string,
  userMessage: string,
  clientId: string
): Promise<PatientDetectionResult> {
  const logger = createConversationLogger(phoneNumber, clientId, 'nlu_processing')
  logger.info('Processing with NLU', { message: userMessage.substring(0, 50) })

  const patientInfo = await getDetectedPatientInfo(phoneNumber)

  if (!patientInfo) {
    logger.warn('No patient info found', { phone: phoneNumber })
    return {
      handled: false,
      shouldCallOpenAI: true,
      openAIContext: 'No patient context available',
    }
  }

  try {
    // Llamar al extractor de intenciones
    const intentResult = await extractIntent(userMessage, phoneNumber, clientId, {
      isNewPatient: patientInfo.isNewPatient,
      patientName: patientInfo.patientName,
      patientTurnos: patientInfo.turnos,
    })

    if (!intentResult) {
      logger.warn('Intent extraction failed', {})
      return {
        handled: false,
        shouldCallOpenAI: true,
        openAIContext: 'NLU error, fallback to full router',
      }
    }

    logger.info('Intent extracted', {
      intent: intentResult.intent,
      confidence: intentResult.confidence,
    })

    // Mapear intención a acción
    const action = mapIntentToAction(intentResult.intent, patientInfo.isNewPatient)

    return {
      handled: true,
      message: `Entendido: ${intentResult.reasoning}`,
      action,
      patientInfo: patientInfo,
    }
  } catch (error) {
    logger.error('Error in NLU processing', error as Error)
    return {
      handled: false,
      shouldCallOpenAI: true,
      openAIContext: 'NLU error',
    }
  }
}
