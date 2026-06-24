import { createConversationLogger } from '../logger'
import { getEffectiveFeatureFlags } from '../feature-flags'
import {
  startPatientDetectionFlow,
  processPatientDetectionMessage,
  isPatientDetectionFlowActive,
  getDetectedPatientInfo,
  clearPatientDetectionFlow,
  processDNIForDisambiguation,
  getPatientDetectionState,
  updatePatientDetectionPhase,
} from './patient-flow-handler'
import {
  buildExistingPatientGreeting,
  buildNewPatientGreeting,
  buildMultiplePatientGreeting,
  buildSelectionConfirmation,
  buildInvalidSelectionMessage,
  buildDetectionErrorMessage,
  buildTurnosSummary,
  buildOtherInquiryMessage,
  buildTurnoIntentConfirmedMessage,
  buildFamiliarDNIRequestContextualMessage,
} from './patient-templates'
import { detectFamiliarIntent } from './familiar-intent-detector'

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
    patientDNI?: string
    patientLastName?: string
    patientFirstName?: string
    obraSocialId?: string
    obraSocialNombre?: string
    turnos?: any[]
    turnosQx?: any[]
  }
  shouldCallOpenAI?: boolean
  openAIContext?: string
}

/**
 * Punto de entrada principal: Iniciar detección de paciente
 * Se llama cuando el usuario escribe SIN recordatorio previo
 * @param phoneNumber - Número de teléfono del usuario
 * @param configId - ID de configuración de WhatsApp (para feature flags y logging)
 * @param clienteId - ID del cliente en el sistema de la clínica (para llamadas a la API)
 * @param clinicName - Nombre de la clínica/centro para personalizar mensajes
 */
export async function initializePatientDetection(
  phoneNumber: string,
  configId: string,
  clienteId: string,
  clinicName?: string,
  firstMessage?: string
): Promise<PatientDetectionResult> {
  const logger = createConversationLogger(phoneNumber, configId, 'initial_detection_pending')
  logger.info('Initializing patient detection', {})

  // Verificar si el feature flag está habilitado
  const flags = await getEffectiveFeatureFlags(configId)

  console.log(`[v0] [INIT_DETECTION] flag directPatientDetection=${flags.directPatientDetection} configId=${configId}`)

  if (!flags.directPatientDetection) {
    logger.debug('Feature flag disabled, using OpenAI', {})
    return {
      handled: false,
      shouldCallOpenAI: true,
      openAIContext: 'Patient detection disabled, route to asst_router',
    }
  }

  try {
    const detectionResult = await startPatientDetectionFlow(phoneNumber, configId, clienteId)
    console.log(`[v0] [INIT_DETECTION] startPatientDetectionFlow result: isNewPatient=${detectionResult.isNewPatient} error=${detectionResult.error} multiplePatients=${detectionResult.multiplePatients?.length}`)

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
        message: buildNewPatientGreeting(clinicName),
        patientInfo: {
          isNewPatient: true,
        },
      }
    }

    // Si hay múltiples pacientes, solicitar DNI
    if (detectionResult.multiplePatients && detectionResult.multiplePatients.length > 1) {
      logger.info('Multiple patients detected, requesting DNI', {
        count: detectionResult.multiplePatients.length,
        phone: phoneNumber,
      })
      return {
        handled: true,
        message: buildMultiplePatientGreeting(detectionResult.multiplePatients, clinicName),
        patientInfo: {
          isNewPatient: false,
        },
      }
    }

    // Paciente existente: detectar intención de familiar en primer mensaje
    if (firstMessage) {
      const familiarIntent = detectFamiliarIntent(firstMessage)
      if (familiarIntent.detected) {
        console.log(`[v0] [INIT_DETECTION] Familiar intent detected: relation="${familiarIntent.relation}" from message="${firstMessage.substring(0, 60)}"`)
        await updatePatientDetectionPhase(phoneNumber, 'awaiting_familiar_dni')
        const callerFirstName = (detectionResult.patientName || 'Hola').split(' ')[0]
        const firstName = callerFirstName.charAt(0).toUpperCase() + callerFirstName.slice(1).toLowerCase()
        return {
          handled: true,
          message: buildFamiliarDNIRequestContextualMessage(firstName, familiarIntent.relation),
          patientInfo: {
            isNewPatient: false,
            patientId: detectionResult.patientId,
            patientName: detectionResult.patientName,
            turnos: detectionResult.turnos,
          },
        }
      }
    }

    // Paciente existente: mostrar saludo con turnos
    const greeting = buildExistingPatientGreeting(
      detectionResult.patientName || 'Paciente',
      detectionResult.turnos || [],
      clinicName,
      detectionResult.turnosQx || []
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

  // Leer el estado actual para saber en qué fase estamos
  const state = await getPatientDetectionState(phoneNumber)

  if (!state) {
    logger.warn('No state found despite flow being active', {})
    return { handled: false, shouldCallOpenAI: true }
  }

  // --- Fase: Selección de intención de contacto (paciente nuevo — turno vs consulta) ---
  if (state.phase === 'awaiting_contact_intent') {
    logger.info('Processing contact intent selection', {})
    // Delegar a whatsapp.tsx para procesar con clienteId disponible
    return {
      handled: false,
      shouldCallOpenAI: false,
      action: 'contact_intent_pending',
      patientInfo: { isNewPatient: true },
    }
  }

  // --- Fase: Espera de DNI del familiar ---
  if (state.phase === 'awaiting_familiar_dni') {
    logger.info('Processing familiar DNI input', {})
    const dniOnly = userMessage.trim().replace(/[^0-9]/g, '')

    if (dniOnly.length < 7 || dniOnly.length > 9) {
      return {
        handled: true,
        message:
          'El DNI no parece válido. Por favor, indicame el DNI del familiar (7 u 8 dígitos) sin puntos ni espacios.',
      }
    }

    // Tiene formato de DNI válido — delegar a whatsapp.tsx con clienteId
    return {
      handled: false,
      shouldCallOpenAI: false,
      action: 'familiar_dni_pending',
      patientInfo: { isNewPatient: false },
    }
  }

  // --- Fase: Espera de DNI para desambiguar múltiples pacientes ---
  if (state.phase === 'awaiting_dni_for_disambiguation') {
    logger.info('Processing DNI for disambiguation', {})
    // La desambiguación necesita clienteId real, pero desde aquí solo tenemos configId.
    // Delegamos al handler que ya tiene la lógica correcta.
    const dniOnly = userMessage.trim().replace(/[^0-9]/g, '')

    if (dniOnly.length < 7 || dniOnly.length > 9) {
      return {
        handled: true,
        message:
          'El DNI ingresado no parece válido. Por favor indicame tu DNI (7 u 8 dígitos) sin puntos ni espacios.',
      }
    }

    // Necesitamos clienteId para llamar a la API — lo pasamos como shouldCallOpenAI
    // para que whatsapp.tsx lo procese con clienteId disponible.
    // Por eso retornamos una señal especial para que whatsapp.tsx llame a handleDNIForMultiplePatients.
    return {
      handled: false,
      shouldCallOpenAI: false,
      action: 'dni_disambiguation_pending',
      patientInfo: { isNewPatient: false },
    }
  }

  // --- Fase: Espera de respuesta inicial (paciente nuevo — pide DNI) ---
  if (state.phase === 'awaiting_initial_response') {
    const dniOnly = userMessage.trim().replace(/[^0-9]/g, '')
    if (dniOnly.length >= 7 && dniOnly.length <= 9) {
      // Tiene pinta de DNI — delegar a whatsapp.tsx con clienteId
      return {
        handled: false,
        shouldCallOpenAI: false,
        action: 'new_patient_dni_pending',
        patientInfo: { isNewPatient: true },
      }
    }
    // Texto libre — va a OpenAI
    return {
      handled: false,
      shouldCallOpenAI: true,
      openAIContext: 'New patient, waiting for DNI. Extract DNI from message.',
    }
  }

  // --- Fase: Selección de acción (menú 1-4) ---
  const processResult = await processPatientDetectionMessage(
    phoneNumber,
    userMessage,
    clientId
  )

  if (!processResult.handled) {
    // Mensaje no numérico — requiere NLU
    logger.info('Message requires NLU processing', {
      nextPhase: processResult.nextPhase,
    })

    const patientInfo = await getDetectedPatientInfo(phoneNumber)
    let openAIContext = ''
    if (patientInfo && !patientInfo.isNewPatient) {
      openAIContext =
        `Paciente existente: ${patientInfo.patientName}. ` +
        `Tiene ${patientInfo.turnos?.length || 0} turno(s) agendado(s). ` +
        `Opciones disponibles: 1-Confirmar turno, 2-Cancelar turno, 3-Solicitar otro turno.`
    }

    return {
      handled: false,
      shouldCallOpenAI: true,
      openAIContext,
    }
  }

  // Selección numérica válida procesada
  logger.info('Valid selection processed', {
    action: processResult.action,
  })

  // La acción se propaga a whatsapp.tsx para derivar al flujo correspondiente
  return {
    handled: true,
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
 * Procesa DNI cuando hay múltiples pacientes
 * Se llama cuando el usuario envía su DNI durante la fase de desambiguación
 */
export async function handleDNIForMultiplePatients(
  phoneNumber: string,
  dniMessage: string,
  configId: string,
  clienteId: string,
  clinicName?: string
): Promise<PatientDetectionResult> {
  const logger = createConversationLogger(phoneNumber, configId, 'dni_disambiguation')
  logger.info('Processing DNI for multiple patients', {})

  // Verificar estado
  const state = await getPatientDetectionState(phoneNumber)

  if (!state || state.phase !== 'awaiting_dni_for_disambiguation') {
    logger.warn('Invalid state for DNI processing', { phase: state?.phase })
    return {
      handled: false,
      shouldCallOpenAI: true,
      openAIContext: 'Invalid state, route to asst_router',
    }
  }

  // Extraer DNI del mensaje
  const dniMatch = dniMessage.trim().replace(/[^0-9]/g, '')

  if (dniMatch.length < 7 || dniMatch.length > 9) {
    logger.warn('Invalid DNI format', { length: dniMatch.length })
    return {
      handled: true,
      message:
        `El DNI no parece válido. ` +
        `Por favor, ingresa tu DNI sin puntos ni espacios (7 u 8 dígitos).`,
      patientInfo: {
        isNewPatient: false,
      },
    }
  }

  // Procesar DNI
  const result = await processDNIForDisambiguation(
    phoneNumber,
    dniMatch,
    configId,
    clienteId
  )

  if (!result.found) {
    logger.warn('DNI not found in patients list', {})

    if (result.error?.includes('Max attempts')) {
      // Después de 3 intentos fallidos, registrar como nuevo paciente
      await clearPatientDetectionFlow(phoneNumber, configId)
      return {
        handled: true,
        message: buildNewPatientGreeting(clinicName),
        patientInfo: {
          isNewPatient: true,
        },
      }
    }

    return {
      handled: true,
      message:
        `El DNI ${dniMatch} no está registrado con este número de teléfono. ` +
        `Por favor, intenta de nuevo o contacta al centro.\n\n` +
        `${result.error || ''}`,
      patientInfo: {
        isNewPatient: false,
      },
    }
  }

  // Paciente identificado correctamente
  logger.info('Patient identified', {
    patientId: result.patientId,
    patientName: result.patientName,
  })

  const greeting = buildExistingPatientGreeting(
    result.patientName || 'Paciente',
    result.turnos || [],
    clinicName,
    result.turnosQx || []
  )

  return {
    handled: true,
    message: greeting,
    patientInfo: {
      isNewPatient: false,
      patientId: result.patientId,
      patientName: result.patientName,
      turnos: result.turnos,
    },
  }
}

/**
 * Procesa el DNI del familiar ingresado por el usuario
 * Busca al familiar en el sistema y arranca el flujo de paciente existente o nuevo
 */
// Re-export functions from handler so they can be imported from this module
export { isPatientDetectionFlowActive, getDetectedPatientInfo, clearPatientDetectionFlow, updatePatientDetectionPhase, getIdentifiedPatient, clearIdentifiedPatient, returnPatientToMenu } from './patient-flow-handler'
