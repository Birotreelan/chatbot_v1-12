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
  phase: 'awaiting_initial_response' | 'awaiting_dni_for_disambiguation' | 'awaiting_action_selection' | 'completed'
  patientPhone: string
  patientId?: string
  patientName?: string
  patientDNI?: string
  turnos?: any[]
  multiplePatients?: any[] // Array de pacientes si hay múltiples
  detectedAt: number
  attempts: number
}

/**
 * Inicia el flujo de detección de paciente
 * Busca al paciente por teléfono y obtiene sus turnos próximos
 * Detecta si hay múltiples pacientes asociados al teléfono
 */
export async function startPatientDetectionFlow(
  phoneNumber: string,
  configId: string,
  clienteId: string
): Promise<{
  isNewPatient: boolean
  multiplePatients?: any[]
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

    // Verificar si hay múltiples pacientes
    const patientData = patientResponse.datos
    let multiplePatients: any[] | null = null
    let patient: any
    let turnosFromResponse: any[] = []

    // Caso 1: Respuesta con warning "pacientes_multiples" (estructura real de la API)
    if (patientData.warning === 'pacientes_multiples' && Array.isArray(patientData.pacientes)) {
      multiplePatients = patientData.pacientes
      logger.info('Multiple patients found by phone (pacientes_multiples)', {
        count: patientData.total_pacientes || multiplePatients.length,
        phone: phoneNumber,
      })
    }
    // Caso 2: Respuesta con objeto "paciente" (paciente único - estructura real de la API)
    else if (patientData.paciente) {
      patient = patientData.paciente
      // Los turnos ya vienen en la respuesta
      turnosFromResponse = patientData.turnos_proximos || []
      logger.info('Single patient found by phone (paciente object)', {
        patientId: patient.Id,
        patientName: patient.Nombres,
        turnosCount: turnosFromResponse.length,
      })
    }
    // Caso 3: Array directo de múltiples pacientes
    else if (Array.isArray(patientData)) {
      if (patientData.length > 1) {
        multiplePatients = patientData
        logger.info('Multiple patients found by phone (array)', {
          count: multiplePatients.length,
          phone: phoneNumber,
        })
      } else if (patientData.length === 1) {
        patient = patientData[0]
      }
    }
    // Caso 4: Objeto con flag "multiple" y array de pacientes
    else if (patientData.multiple && Array.isArray(patientData.pacientes)) {
      multiplePatients = patientData.pacientes
      logger.info('Multiple patients found by phone (multiple flag)', {
        count: multiplePatients.length,
        phone: phoneNumber,
      })
    }
    // Caso 5: Paciente único directo (fallback)
    else {
      patient = patientData
    }

    // Si hay múltiples pacientes, solicitar DNI para desambiguar
    if (multiplePatients && multiplePatients.length > 1) {
      const multiPatientState: PatientDetectionState = {
        phase: 'awaiting_dni_for_disambiguation',
        patientPhone: phoneNumber,
        multiplePatients: multiplePatients,
        detectedAt: Date.now(),
        attempts: 1,
      }

      await redis.setex(
        `${PATIENT_DETECTION_STATE_KEY}:${phoneNumber}`,
        PATIENT_DETECTION_TTL,
        JSON.stringify(multiPatientState)
      )

      return {
        isNewPatient: false,
        multiplePatients: multiplePatients,
        message: 'Multiple patients found, requesting DNI',
      }
    }

    // Si solo hay un paciente (o solo uno en el array)
    if (!patient && multiplePatients && multiplePatients.length === 1) {
      patient = multiplePatients[0]
    }

    // Paciente encontrado - normalizar campos (API usa mayusculas: Id, Nrodoc, Apellido, Nombres)
    const patientId = patient.paciente_id || patient.Id || patient.id
    const patientName = patient.nombre || patient.Nombres || `${patient.Nombres || ''} ${patient.Apellido || ''}`.trim()
    const patientDNI = patient.dni || patient.Nrodoc

    logger.info('Patient found', {
      patientId,
      patientName: patientName,
    })

    // Usar turnos de la respuesta inicial si existen, sino buscar
    let turnos: any[] = turnosFromResponse
    
    // Si no hay turnos en la respuesta, intentar buscarlos
    if (turnos.length === 0 && patientDNI) {
      try {
        const dateRange = getDefaultDateRange()

        const turnosResponse = await clinicAPI.obtenerTurnos(
          dateRange.desde,
          dateRange.hasta,
          undefined,
          patientDNI
        )

        if (turnosResponse.exito && turnosResponse.datos) {
          turnos = Array.isArray(turnosResponse.datos)
            ? turnosResponse.datos
            : turnosResponse.datos.turnos || []
        }
      } catch (e) {
        logger.warn('Error fetching turns', {
          error: String(e),
          patientId,
        })
      }
    }

    // Filtrar turnos cancelados
    turnos = turnos.filter(
      (t: any) => t.estado !== 'cancelado' && t.status !== 'cancelado' && t.Estado !== 'Cancelado'
    )

    // Crear estado para paciente existente
    const existingPatientState: PatientDetectionState = {
      phase: 'awaiting_action_selection',
      patientPhone: phoneNumber,
      patientId: patientId,
      patientName: patientName,
      patientDNI: patientDNI,
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
      patientName: patientName,
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
 * Procesa el DNI cuando hay múltiples pacientes
 * Identifica al paciente correcto y obtiene sus turnos
 */
export async function processDNIForDisambiguation(
  phoneNumber: string,
  dni: string,
  configId: string,
  clienteId: string
): Promise<{
  found: boolean
  patientId?: string
  patientName?: string
  turnos?: any[]
  message?: string
  error?: string
}> {
  const logger = createConversationLogger(phoneNumber, configId, 'dni_disambiguation')
  logger.info('Processing DNI for patient disambiguation', { dni: dni.substring(0, 3) + '****' })

  try {
    const redis = getRedisClient()
    if (!redis) {
      logger.warn('Redis not available', {})
      return { found: false, error: 'Redis unavailable' }
    }

    // Obtener estado actual (debe estar en fase de espera de DNI)
    const state = await getPatientDetectionState(phoneNumber)
    if (!state || state.phase !== 'awaiting_dni_for_disambiguation') {
      logger.warn('Invalid state for DNI disambiguation', { phase: state?.phase })
      return { found: false, error: 'Invalid state' }
    }

    if (!state.multiplePatients || state.multiplePatients.length === 0) {
      logger.warn('No multiple patients in state', {})
      return { found: false, error: 'No patients to disambiguate' }
    }

    // Buscar el paciente que coincida con el DNI
    const matchingPatient = state.multiplePatients.find(
      (p: any) => p.dni && p.dni.replace(/[^0-9]/g, '') === dni.replace(/[^0-9]/g, '')
    )

    if (!matchingPatient) {
      logger.warn('No patient found with provided DNI', {})

      // Incrementar intentos
      state.attempts = (state.attempts || 0) + 1
      if (state.attempts >= 3) {
        // Después de 3 intentos fallidos, marcar como nuevo paciente
        await redis.del(`${PATIENT_DETECTION_STATE_KEY}:${phoneNumber}`)
        return { 
          found: false, 
          error: 'Max attempts reached. Will register as new patient.' 
        }
      }

      await redis.setex(
        `${PATIENT_DETECTION_STATE_KEY}:${phoneNumber}`,
        PATIENT_DETECTION_TTL,
        JSON.stringify(state)
      )

      return { 
        found: false, 
        error: `DNI no encontrado. Intento ${state.attempts} de 3.` 
      }
    }

    // Paciente encontrado con el DNI
    logger.info('Patient identified by DNI', {
      patientId: matchingPatient.paciente_id || matchingPatient.id,
      patientName: matchingPatient.nombre,
    })

    // Obtener turnos próximos
    let turnos: any[] = []
    try {
      const clinicAPI = new ClinicAPI(clienteId)
      const dateRange = getDefaultDateRange()

      const turnosResponse = await clinicAPI.obtenerTurnos(
        dateRange.desde,
        dateRange.hasta,
        undefined,
        matchingPatient.dni
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
        patientId: matchingPatient.paciente_id || matchingPatient.id,
      })
    }

    // Actualizar estado a paciente existente identificado
    const identifiedPatientState: PatientDetectionState = {
      phase: 'awaiting_action_selection',
      patientPhone: phoneNumber,
      patientId: matchingPatient.paciente_id || matchingPatient.id,
      patientName: matchingPatient.nombre,
      patientDNI: matchingPatient.dni,
      turnos: turnos,
      detectedAt: Date.now(),
      attempts: 0,
    }

    await redis.setex(
      `${PATIENT_DETECTION_STATE_KEY}:${phoneNumber}`,
      PATIENT_DETECTION_TTL,
      JSON.stringify(identifiedPatientState)
    )

    return {
      found: true,
      patientId: matchingPatient.paciente_id || matchingPatient.id,
      patientName: matchingPatient.nombre,
      turnos: turnos,
      message: `Patient identified as ${matchingPatient.nombre}`,
    }
  } catch (error) {
    logger.error('Error processing DNI for disambiguation', error as Error)
    return {
      found: false,
      error: 'Error processing DNI',
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

  // Upstash puede devolver objeto ya deserializado o string JSON
  const state: PatientDetectionState = typeof stateStr === 'object'
    ? stateStr as PatientDetectionState
    : JSON.parse(stateStr as string)

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

  // Upstash puede devolver objeto ya deserializado o string JSON
  if (typeof stateStr === 'object') return stateStr as PatientDetectionState
  return JSON.parse(stateStr as string) as PatientDetectionState
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
