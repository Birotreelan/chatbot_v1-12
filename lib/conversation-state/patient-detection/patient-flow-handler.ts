import { getRedisClient } from '@/lib/redis'
import { createConversationLogger } from '../logger'
import { ClinicAPI } from '../../clinic-api'

/**
 * Patient Detection Flow Handler
 * Detecta pacientes por teléfono y muestra saludo personalizado con turnos próximos
 * Sin recordatorio previo, cuando el usuario escribe primero
 */

const PATIENT_DETECTION_STATE_KEY = 'patient_detection_state'
const PATIENT_DETECTION_TTL = 86400 // 24 horas

/**
 * Helper: Obtiene rango de fechas dinámico (hoy a próxima semana)
 */
function getDefaultDateRange(): { desde: string; hasta: string } {
  const today = new Date()
  const nextWeek = new Date(today)
  nextWeek.setDate(today.getDate() + 7)

  const formatDate = (date: Date): string => {
    return date.toISOString().split('T')[0] // YYYY-MM-DD
  }

  return {
    desde: formatDate(today),
    hasta: formatDate(nextWeek),
  }
}

/**
 * Tipos internos del flujo
 */
interface PatientDetectionState {
  phase: 'awaiting_initial_response' | 'awaiting_action_selection' | 'completed'
  patientPhone: string
  patientId?: string
  patientName?: string
  patientDNI?: string
  turnos?: any[]
  detectedAt: number
  attempts: number
}

/**
 * Inicia el flujo de detección de paciente
 * Busca al paciente por teléfono y obtiene sus turnos próximos
 */
export async function startPatientDetectionFlow(
  phoneNumber: string,
  configId: string,
  clienteId: string
): Promise<{
  isNewPatient: boolean
  patientName?: string
  patientId?: string
  turnos?: any[]
  message?: string
  error?: string
}> {
  const logger = createConversationLogger(phoneNumber, configId, 'initial_detection_pending')
  logger.info('Starting patient detection flow', { phone: phoneNumber })

  try {
    const redis = getRedisClient()
    if (!redis) {
      logger.warn('Redis not available', {})
      return { isNewPatient: true, error: 'Redis unavailable' }
    }

    // Crear instancia de ClinicAPI con el clienteId REAL (no el configId)
    const clinicAPI = new ClinicAPI(clienteId)

    // Buscar paciente por teléfono
    const patientResponse = await clinicAPI.paciente_telefono(phoneNumber)

    if (!patientResponse.exito || !patientResponse.datos) {
      logger.info('Patient not found by phone', { phone: phoneNumber })

      // Crear estado para paciente nuevo
      const newPatientState: PatientDetectionState = {
        phase: 'awaiting_initial_response',
        patientPhone: phoneNumber,
        detectedAt: Date.now(),
        attempts: 1,
      }

      await redis.setex(
        `${PATIENT_DETECTION_STATE_KEY}:${phoneNumber}`,
        PATIENT_DETECTION_TTL,
        JSON.stringify(newPatientState)
      )

      return {
        isNewPatient: true,
        message: 'Patient not found, will request DNI',
      }
    }

    // Paciente encontrado
    const patient = patientResponse.datos
    const patientId = patient.paciente_id || patient.id

    logger.info('Patient found', {
      patientId,
      patientName: patient.nombre,
    })

    // Obtener turnos próximos
    let turnos: any[] = []
    try {
      const dateRange = getDefaultDateRange()

      // Obtener turnos del paciente
      const turnosResponse = await clinicAPI.obtenerTurnos(
        dateRange.desde,
        dateRange.hasta,
        undefined,
        patient.dni
      )

      if (turnosResponse.exito && turnosResponse.datos) {
        turnos = Array.isArray(turnosResponse.datos)
          ? turnosResponse.datos
          : turnosResponse.datos.turnos || []

        // Filtrar turnos cancelados
        turnos = turnos.filter(
          (t: any) => t.estado !== 'cancelado' && t.status !== 'cancelado'
        )
      }
    } catch (e) {
      logger.warn('Error fetching turns', {
        error: String(e),
        patientId,
      })
    }

    // Crear estado para paciente existente
    const existingPatientState: PatientDetectionState = {
      phase: 'awaiting_action_selection',
      patientPhone: phoneNumber,
      patientId: patientId,
      patientName: patient.nombre,
      patientDNI: patient.dni,
      turnos: turnos,
      detectedAt: Date.now(),
      attempts: 0,
    }

    await redis.setex(
      `${PATIENT_DETECTION_STATE_KEY}:${phoneNumber}`,
      PATIENT_DETECTION_TTL,
      JSON.stringify(existingPatientState)
    )

    return {
      isNewPatient: false,
      patientName: patient.nombre,
      patientId: patientId,
      turnos: turnos,
    }
  } catch (error) {
    logger.error('Error in patient detection', error as Error)

    return {
      isNewPatient: true,
      error: 'API error, will request DNI',
    }
  }
}

/**
 * Procesa mensaje del usuario durante el flujo de detección
 */
export async function processPatientDetectionMessage(
  phoneNumber: string,
  userMessage: string,
  clientId: string
): Promise<{
  handled: boolean
  action?: string
  nextPhase?: string
  data?: any
}> {
  const logger = createConversationLogger(phoneNumber, clientId, 'initial_detection_awaiting_action')
  logger.info('Processing message', {
    message: userMessage.substring(0, 50),
  })

  const redis = getRedisClient()
  if (!redis) {
    logger.warn('Redis not available', {})
    return { handled: false }
  }

  const stateKey = `${PATIENT_DETECTION_STATE_KEY}:${phoneNumber}`
  const stateStr = await redis.get(stateKey)

  if (!stateStr) {
    logger.debug('No state found', { phone: phoneNumber })
    return { handled: false }
  }

  const state: PatientDetectionState = JSON.parse(stateStr)

  // Detectar selección numérica (1-4)
  const numMatch = userMessage.trim().match(/^[1-4]$/)

  if (!numMatch) {
    logger.info('Non-numeric input, requires NLU', {
      message: userMessage.substring(0, 50),
    })
    return {
      handled: false,
      nextPhase: 'nlu_required',
    }
  }

  const selection = parseInt(numMatch[0], 10)

  logger.info('Numeric selection detected', {
    selection,
    phase: state.phase,
  })

  // Mapear acciones según fase
  if (state.phase === 'awaiting_action_selection') {
    // Paciente existente: 1-Confirmar, 2-Cancelar, 3-Nuevo turno, 4-Consulta
    const actionMap: Record<number, string> = {
      1: 'confirm_appointment',
      2: 'cancel_appointment',
      3: 'book_new_appointment',
      4: 'other_inquiry',
    }

    const action = actionMap[selection]

    if (action) {
      // Marcar flujo como completado
      state.phase = 'completed'
      await redis.setex(stateKey, 3600, JSON.stringify(state)) // 1 hora

      return {
        handled: true,
        action,
        nextPhase: 'action_processing',
        data: {
          patientId: state.patientId,
          patientName: state.patientName,
          turnos: state.turnos,
        },
      }
    }
  } else if (state.phase === 'awaiting_initial_response') {
    // Paciente nuevo: solo solicitar DNI, no procesamos números aquí
    return {
      handled: false,
      nextPhase: 'nlu_required',
    }
  }

  return {
    handled: false,
    nextPhase: 'invalid_selection',
  }
}

/**
 * Verifica si el flujo de detección está activo para este usuario
 */
export async function isPatientDetectionFlowActive(
  phoneNumber: string
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false

  const stateKey = `${PATIENT_DETECTION_STATE_KEY}:${phoneNumber}`
  const state = await redis.get(stateKey)
  return !!state
}

/**
 * Obtiene el estado actual del flujo de detección
 */
export async function getPatientDetectionState(
  phoneNumber: string
): Promise<PatientDetectionState | null> {
  const redis = getRedisClient()
  if (!redis) return null

  const stateKey = `${PATIENT_DETECTION_STATE_KEY}:${phoneNumber}`
  const stateStr = await redis.get(stateKey)

  if (!stateStr) return null

  return JSON.parse(stateStr) as PatientDetectionState
}

/**
 * Limpia el estado del flujo de detección
 */
export async function clearPatientDetectionFlow(
  phoneNumber: string,
  clientId: string
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  const logger = createConversationLogger(phoneNumber, clientId, 'initial_detection_pending')
  const stateKey = `${PATIENT_DETECTION_STATE_KEY}:${phoneNumber}`
  await redis.del(stateKey)
  logger.info('Flow cleared', {})
}

/**
 * Obtiene información del paciente detectado
 */
export async function getDetectedPatientInfo(phoneNumber: string): Promise<{
  isNewPatient: boolean
  patientId?: string
  patientName?: string
  patientDNI?: string
  turnos?: any[]
} | null> {
  const state = await getPatientDetectionState(phoneNumber)

  if (!state) return null

  return {
    isNewPatient: !state.patientId,
    patientId: state.patientId,
    patientName: state.patientName,
    patientDNI: state.patientDNI,
    turnos: state.turnos,
  }
}
