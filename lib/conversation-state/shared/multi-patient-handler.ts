/**
 * Multi-Patient Handler
 * Gestiona el flujo cuando un usuario quiere agendar para un familiar
 * 
 * Flujo:
 * 1. Usuario selecciona opción 3/4 "Solicitar turno para un familiar"
 * 2. Se solicita DNI del familiar
 * 3. Si existe: continuar con flujo normal usando datos del familiar
 * 4. Si NO existe: pedir nombre y crear como paciente nuevo
 */

import { getRedisClient } from '@/lib/redis'
import { createConversationLogger } from '../logger'
import { ClinicAPI } from '@/lib/clinic-api'
import {
  buildFamilyAppointmentStartMessage,
  buildFamilyPatientFoundMessage,
  buildFamilyNewPatientMessage,
  buildFamilyInvalidDNIMessage,
} from '../patient-detection/patient-templates'

// Clave de Redis para el estado del flujo multiusuario
const MULTI_PATIENT_FLOW_KEY = 'multi_patient_flow'

// TTL en segundos (2 horas)
const FLOW_TTL = 7200

/**
 * Estado del flujo multiusuario
 */
interface MultiPatientFlowState {
  requesterPhoneNumber: string
  requesterPatientName?: string
  requesterPatientId?: string
  requesterDNI?: string
  targetPatientDNI?: string
  targetPatientName?: string
  targetPatientId?: string
  phase: 'awaiting_target_dni' | 'awaiting_target_name' | 'completed'
  attempts: number
  createdAt: number
}

/**
 * Resultado del manejo del flujo
 */
interface MultiPatientResult {
  handled: boolean
  message?: string
  action?: string
  patientInfo?: {
    patientId?: string
    patientName?: string
    patientDNI?: string
  }
}

/**
 * Guarda el estado del flujo en Redis
 */
async function saveFlowState(phoneNumber: string, state: MultiPatientFlowState): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  
  const key = `${MULTI_PATIENT_FLOW_KEY}:${phoneNumber}`
  await redis.setex(key, FLOW_TTL, JSON.stringify(state))
}

/**
 * Obtiene el estado del flujo de Redis
 */
async function getFlowState(phoneNumber: string): Promise<MultiPatientFlowState | null> {
  const redis = getRedisClient()
  if (!redis) return null
  
  const key = `${MULTI_PATIENT_FLOW_KEY}:${phoneNumber}`
  const data = await redis.get(key)
  
  if (!data) return null
  
  if (typeof data === 'object') return data as MultiPatientFlowState
  
  try {
    return JSON.parse(data) as MultiPatientFlowState
  } catch {
    return null
  }
}

/**
 * Inicializa el flujo multiusuario cuando el usuario selecciona "turno para familiar"
 */
export async function initializeMultiPatientFlow(
  phoneNumber: string,
  requesterName?: string,
  requesterDNI?: string,
  requesterPatientId?: string
): Promise<{ message: string }> {
  const state: MultiPatientFlowState = {
    requesterPhoneNumber: phoneNumber,
    requesterPatientName: requesterName,
    requesterPatientId: requesterPatientId,
    requesterDNI: requesterDNI,
    phase: 'awaiting_target_dni',
    attempts: 0,
    createdAt: Date.now(),
  }
  
  await saveFlowState(phoneNumber, state)
  
  return {
    message: buildFamilyAppointmentStartMessage(),
  }
}

/**
 * Maneja la entrada del DNI del familiar
 */
export async function handleTargetDNIInput(
  phoneNumber: string,
  userMessage: string,
  clienteId: string,
  configId: string
): Promise<MultiPatientResult> {
  const logger = createConversationLogger(phoneNumber, configId, 'multi_patient')
  
  const state = await getFlowState(phoneNumber)
  if (!state || state.phase !== 'awaiting_target_dni') {
    return { handled: false }
  }
  
  // Extraer solo dígitos del mensaje
  const dniOnly = userMessage.replace(/\D/g, '')
  
  // Validar formato de DNI (7-8 dígitos)
  if (dniOnly.length < 7 || dniOnly.length > 8) {
    state.attempts += 1
    await saveFlowState(phoneNumber, state)
    
    if (state.attempts >= 3) {
      // Después de 3 intentos, tratar como paciente nuevo
      state.phase = 'awaiting_target_name'
      state.targetPatientDNI = dniOnly.length >= 7 ? dniOnly : undefined
      await saveFlowState(phoneNumber, state)
      
      return {
        handled: true,
        message: buildFamilyNewPatientMessage(),
      }
    }
    
    return {
      handled: true,
      message: buildFamilyInvalidDNIMessage(),
    }
  }
  
  logger.info('Validating target patient DNI', { dni: dniOnly })
  
  // Buscar paciente en la API de la clínica
  try {
    const clinicAPI = new ClinicAPI(clienteId)
    const paciente = await clinicAPI.buscarPacientePorDNI(dniOnly)
    
    if (paciente) {
      // Paciente encontrado
      const pacienteNombre = paciente.Nombre || paciente.nombre || 'Paciente'
      const pacienteId = paciente.Id || paciente.id || ''
      
      state.targetPatientDNI = dniOnly
      state.targetPatientName = pacienteNombre
      state.targetPatientId = pacienteId
      // Mantener phase en awaiting_target_dni hasta que whatsapp.tsx procese y limpie
      
      await saveFlowState(phoneNumber, state)
      
      logger.info('Target patient found', {
        patientName: pacienteNombre,
        patientDNI: dniOnly,
      })
      
      return {
        handled: true,
        action: 'patient_found',
        message: buildFamilyPatientFoundMessage(pacienteNombre, dniOnly),
        patientInfo: {
          patientId: pacienteId,
          patientName: pacienteNombre,
          patientDNI: dniOnly,
        },
      }
    } else {
      // Paciente NO encontrado - crear como nuevo
      state.phase = 'awaiting_target_name'
      state.targetPatientDNI = dniOnly
      await saveFlowState(phoneNumber, state)
      
      logger.info('Target patient not found, creating as new', { dni: dniOnly })
      
      return {
        handled: true,
        action: 'patient_not_found',
        message: buildFamilyNewPatientMessage(),
      }
    }
  } catch (error) {
    logger.error('Error searching for target patient', { error })
    
    // En caso de error, continuar como paciente nuevo
    state.phase = 'awaiting_target_name'
    state.targetPatientDNI = dniOnly
    await saveFlowState(phoneNumber, state)
    
    return {
      handled: true,
      action: 'patient_not_found',
      message: buildFamilyNewPatientMessage(),
    }
  }
}

/**
 * Maneja la entrada del nombre del familiar (cuando es paciente nuevo)
 */
export async function handleTargetNameInput(
  phoneNumber: string,
  userMessage: string,
  clienteId: string,
  configId: string
): Promise<MultiPatientResult> {
  const logger = createConversationLogger(phoneNumber, configId, 'multi_patient')
  
  const state = await getFlowState(phoneNumber)
  if (!state || state.phase !== 'awaiting_target_name') {
    return { handled: false }
  }
  
  const nombre = userMessage.trim()
  
  // Validar que tenga al menos un nombre
  if (nombre.length < 3) {
    return {
      handled: true,
      message: 'Por favor, indicame el nombre y apellido completo de la persona.',
    }
  }
  
  state.targetPatientName = nombre
  state.phase = 'completed'
  await saveFlowState(phoneNumber, state)
  
  logger.info('Target patient name captured', { name: nombre, dni: state.targetPatientDNI })
  
  return {
    handled: true,
    action: 'name_captured',
    message: `Perfecto, *${nombre}*. ¿Qué obra social tiene?`,
    patientInfo: {
      patientName: nombre,
      patientDNI: state.targetPatientDNI,
    },
  }
}

/**
 * Verifica si hay un flujo multiusuario activo
 */
export async function isMultiPatientFlowActive(phoneNumber: string): Promise<boolean> {
  const state = await getFlowState(phoneNumber)
  return state !== null && state.phase !== 'completed'
}

/**
 * Obtiene la información del paciente destino
 */
export async function getTargetPatientInfo(phoneNumber: string): Promise<MultiPatientFlowState | null> {
  return await getFlowState(phoneNumber)
}

/**
 * Limpia el flujo multiusuario
 */
export async function clearMultiPatientFlow(phoneNumber: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  
  const key = `${MULTI_PATIENT_FLOW_KEY}:${phoneNumber}`
  await redis.del(key)
}
