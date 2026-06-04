/**
 * Multi-Patient Handler
 * Gestiona el flujo cuando un usuario quiere agendar para un familiar
 * 
 * Flujo:
 * 1. Usuario selecciona opción 3 "Solicitar turno para un familiar"
 * 2. Se solicita DNI del familiar
 * 3. Si existe: continuar con flujo normal usando datos del familiar
 * 4. Si NO existe: pedir nombre y crear como paciente nuevo
 */

import { getRedisClient } from '@/lib/redis'
import { createConversationLogger } from '../logger'
import { ClinicAPI } from '@/lib/clinic-api'

// Constantes
const MULTI_PATIENT_FLOW_KEY = 'multi_patient_flow'
const MULTI_PATIENT_FLOW_TTL = 7200 // 2 horas

/**
 * Estado del flujo multiusuario
 */
export interface MultiPatientFlowState {
  // Información del solicitante (teléfono que hace la solicitud)
  requesterPhoneNumber: string
  requesterPatientName?: string
  requesterPatientId?: string
  requesterDNI?: string

  // Información del paciente destino (para quien se agenda)
  targetPatientDNI?: string
  targetPatientName?: string
  targetPatientId?: string
  targetPatientLastName?: string
  targetPatientEmail?: string

  // Estado del flujo
  phase: 'awaiting_target_dni' | 'awaiting_target_name' | 'completed' | 'error'
  attempts: number
  createdAt: number
  lastUpdated: number
}

/**
 * Obtiene el estado del flujo multiusuario desde Redis
 */
async function getFlowState(phoneNumber: string): Promise<MultiPatientFlowState | null> {
  const redis = getRedisClient()
  if (!redis) return null

  const stateKey = `${MULTI_PATIENT_FLOW_KEY}:${phoneNumber}`
  const stateStr = await redis.get(stateKey)
  if (!stateStr) return null

  return typeof stateStr === 'object' ? stateStr as MultiPatientFlowState : JSON.parse(stateStr as string)
}

/**
 * Guarda el estado del flujo en Redis
 */
async function saveFlowState(phoneNumber: string, state: MultiPatientFlowState): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  state.lastUpdated = Date.now()
  const stateKey = `${MULTI_PATIENT_FLOW_KEY}:${phoneNumber}`
  await redis.setex(stateKey, MULTI_PATIENT_FLOW_TTL, JSON.stringify(state))
}

/**
 * Limpia el flujo multiusuario
 */
export async function clearMultiPatientFlow(phoneNumber: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  const stateKey = `${MULTI_PATIENT_FLOW_KEY}:${phoneNumber}`
  await redis.del(stateKey)
}

/**
 * Inicializa el flujo cuando usuario selecciona opción 3
 */
export async function initializeMultiPatientFlow(
  phoneNumber: string,
  requesterName?: string,
  requesterDNI?: string,
  requesterPatientId?: string,
  configId?: string
): Promise<{ message: string }> {
  const logger = createConversationLogger(phoneNumber, configId || 'unknown', 'multi_patient_init')
  logger.info('Initializing multi-patient flow', {})

  const state: MultiPatientFlowState = {
    requesterPhoneNumber: phoneNumber,
    requesterPatientName: requesterName,
    requesterDNI: requesterDNI,
    requesterPatientId: requesterPatientId,
    phase: 'awaiting_target_dni',
    attempts: 0,
    createdAt: Date.now(),
    lastUpdated: Date.now(),
  }

  await saveFlowState(phoneNumber, state)
  logger.info('Multi-patient flow initialized, requesting target DNI', {})

  return {
    message: '¿Cuál es el DNI de la persona para la que deseas agendar el turno?',
  }
}

/**
 * Procesa el DNI ingresado para el familiar
 */
export async function handleTargetDNIInput(
  phoneNumber: string,
  userMessage: string,
  clientId: string,
  configId: string
): Promise<{
  handled: boolean
  message?: string
  action?: 'patient_found' | 'create_new_patient' | 'invalid_dni' | 'error'
  patientInfo?: {
    patientId?: string
    patientName?: string
    patientLastName?: string
    patientDNI?: string
    isNew: boolean
  }
}> {
  const logger = createConversationLogger(phoneNumber, configId, 'multi_patient_dni')
  
  // Validar DNI
  const dniOnly = userMessage.trim().replace(/[^0-9]/g, '')

  if (dniOnly.length < 7 || dniOnly.length > 9) {
    logger.info('Invalid DNI format', { dniLength: dniOnly.length })
    return {
      handled: true,
      message: 'El DNI ingresado no parece válido. Por favor indicame tu DNI (7 u 8 dígitos) sin puntos ni espacios.',
      action: 'invalid_dni',
    }
  }

  // Obtener estado actual
  const state = await getFlowState(phoneNumber)
  if (!state) {
    logger.warn('No flow state found', {})
    return {
      handled: false,
      action: 'error',
      message: 'Error en el sistema. Por favor intenta nuevamente.',
    }
  }

  // Incrementar intentos
  state.attempts += 1

  try {
    // Buscar paciente por DNI en la clínica
    const clinicAPI = new ClinicAPI(clientId)
    const pacienteResponse = await clinicAPI.paciente_dni(dniOnly)

    if (pacienteResponse.exito && pacienteResponse.datos) {
      // Paciente ENCONTRADO
      const paciente = pacienteResponse.datos
      const pacienteNombre = paciente.Nombre || paciente.nombre || ''
      const pacienteId = paciente.Id || paciente.id || ''

      state.targetPatientDNI = dniOnly
      state.targetPatientName = pacienteNombre
      state.targetPatientId = pacienteId
      // NO marcar como 'completed' aquí - dejar que whatsapp.tsx maneje la transición
      // state.phase será limpiado por clearMultiPatientFlow() después de transicionar

      await saveFlowState(phoneNumber, state)

      logger.info('Target patient found', {
        patientName: pacienteNombre,
        patientDNI: dniOnly,
      })

      // Extraer nombre y apellido si están juntos
      const [nombre, ...apellidoArray] = pacienteNombre.split(' ')
      const apellido = apellidoArray.join(' ')

      return {
        handled: true,
        message: `Perfecto. Encontré a ${pacienteNombre} (DNI ${dniOnly})\nVamos a agendar su turno.`,
        action: 'patient_found',
        patientInfo: {
          patientId: pacienteId,
          patientName: nombre,
          patientLastName: apellido || '',
          patientDNI: dniOnly,
          isNew: false,
        },
      }
    }

    // Paciente NO ENCONTRADO
    logger.info('Target patient not found, will create as new', { dni: dniOnly })

    state.targetPatientDNI = dniOnly
    state.phase = 'awaiting_target_name'

    await saveFlowState(phoneNumber, state)

    return {
      handled: true,
      message: 'Perfecto, lo agendaremos como Paciente Nuevo.\n¿Cuál es el nombre de esta persona?',
      action: 'create_new_patient',
      patientInfo: {
        patientDNI: dniOnly,
        isNew: true,
      },
    }
  } catch (error) {
    logger.error('Error processing target DNI', error as Error)
    state.phase = 'error'
    await saveFlowState(phoneNumber, state)

    return {
      handled: true,
      message: 'Disculpá, ocurrió un error al verificar el DNI. Por favor intenta nuevamente.',
      action: 'error',
    }
  }
}

/**
 * Procesa el nombre del familiar cuando es paciente nuevo
 */
export async function handleTargetNameInput(
  phoneNumber: string,
  userMessage: string,
  clientId: string,
  configId: string
): Promise<{
  handled: boolean
  message?: string
  patientInfo?: {
    patientName?: string
    patientLastName?: string
    patientDNI?: string
    isNew: boolean
  }
}> {
  const logger = createConversationLogger(phoneNumber, configId, 'multi_patient_name')

  // Obtener estado actual
  const state = await getFlowState(phoneNumber)
  if (!state || state.phase !== 'awaiting_target_name') {
    logger.warn('Invalid flow state for name input', { phase: state?.phase })
    return {
      handled: false,
      message: 'Error en el flujo. Por favor intenta nuevamente.',
    }
  }

  const fullName = userMessage.trim()

  if (fullName.length < 3) {
    logger.info('Name too short', { nameLength: fullName.length })
    return {
      handled: true,
      message: 'El nombre parece muy corto. Por favor indicame el nombre completo de la persona.',
    }
  }

  // Extraer nombre y apellido
  const nameParts = fullName.split(' ')
  const firstName = nameParts[0]
  const lastName = nameParts.slice(1).join(' ') || ''

  state.targetPatientName = firstName
  state.targetPatientLastName = lastName
  state.phase = 'completed'

  await saveFlowState(phoneNumber, state)

  logger.info('Target patient name captured', {
    name: firstName,
    lastName: lastName,
  })

  return {
    handled: true,
    message: `Perfecto, ${fullName}. Vamos a crear su registro.`,
    patientInfo: {
      patientName: firstName,
      patientLastName: lastName,
      patientDNI: state.targetPatientDNI,
      isNew: true,
    },
  }
}

/**
 * Verifica si hay un flujo multiusuario activo
 */
export async function isMultiPatientFlowActive(phoneNumber: string): Promise<boolean> {
  const state = await getFlowState(phoneNumber)
  return state !== null && state.phase !== 'completed' && state.phase !== 'error'
}

/**
 * Obtiene la información del paciente destino
 */
export async function getTargetPatientInfo(phoneNumber: string): Promise<MultiPatientFlowState | null> {
  return getFlowState(phoneNumber)
}
