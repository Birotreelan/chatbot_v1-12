import { getRedisClient } from '@/lib/redis'
import { createConversationLogger } from '../logger'
import { ClinicAPI } from '../../clinic-api'
import { extractNumberSelection } from '../selection-extractor'

/**
 * Existing Patient Flow Handler
 * Maneja el flujo completo de reserva de turnos para pacientes existentes
 */

const EXISTING_PATIENT_FLOW_KEY = 'existing_patient_flow'
const EXISTING_PATIENT_FLOW_TTL = 7200 // 2 horas

export interface ExistingPatientFlowState {
  phase:
    | 'initial'
    | 'awaiting_obra_social'
    | 'awaiting_sede'
    | 'awaiting_search_type'
    | 'awaiting_professional'
    | 'awaiting_specialty'
    | 'awaiting_turns'
    | 'awaiting_turn_selection'
    | 'awaiting_email'
    | 'awaiting_confirmation'
    | 'completed'
  patientId: string
  patientName: string
  patientDNI: string
  patientEmail?: string
  obraSocial?: string
  sede?: string
  searchType?: 'doctor' | 'specialty' | 'any'
  professional?: string
  specialty?: string
  turnos?: any[]
  selectedTurno?: any
  attempts: number
  createdAt: number
}

/**
 * Inicia el flujo de paciente existente
 */
export async function startExistingPatientFlow(
  patientId: string,
  patientName: string,
  patientDNI: string,
  patientEmail: string | undefined,
  clientId: string,
  phoneNumber: string
): Promise<{
  nextPhase: string
  message?: string
}> {
  const logger = createConversationLogger(phoneNumber, clientId, 'existing_patient_initial')
  logger.info('Starting existing patient flow', { patientId, patientName })

  const redis = getRedisClient()
  if (!redis) {
    logger.warn('Redis not available', {})
    return { nextPhase: 'error', message: 'Sistema no disponible' }
  }

  const state: ExistingPatientFlowState = {
    phase: patientEmail ? 'awaiting_sede' : 'awaiting_email',
    patientId,
    patientName,
    patientDNI,
    patientEmail,
    attempts: 0,
    createdAt: Date.now(),
  }

  const stateKey = `${EXISTING_PATIENT_FLOW_KEY}:${phoneNumber}`
  await redis.setex(stateKey, EXISTING_PATIENT_FLOW_TTL, JSON.stringify(state))

  logger.info('Flow initialized', { phase: state.phase })

  return {
    nextPhase: state.phase,
  }
}

/**
 * Procesa mensaje en fase de selección de sede
 */
export async function handleSedeSelection(
  phoneNumber: string,
  userMessage: string,
  clientId: string
): Promise<{
  handled: boolean
  nextPhase?: string
  data?: any
  error?: string
}> {
  const logger = createConversationLogger(phoneNumber, clientId, 'existing_patient_sede')
  const state = await getExistingPatientState(phoneNumber)

  if (!state || state.phase !== 'awaiting_sede') {
    return { handled: false }
  }

  const clinicAPI = new ClinicAPI(clientId)

  try {
    // Obtener sedes disponibles
    const sedesResponse = await clinicAPI.obtenerSedes()

    if (!sedesResponse.exito || !sedesResponse.datos) {
      logger.warn('Error getting sedes', {})
      return { handled: false, error: 'No se pudieron obtener las sedes' }
    }

    const sedes = Array.isArray(sedesResponse.datos)
      ? sedesResponse.datos
      : sedesResponse.datos.sedes || []

    // Extraer selección numérica
    const selection = extractNumberSelection(userMessage, sedes.length)

    if (selection === -1) {
      logger.info('Non-numeric input, requires NLU', {})
      return { handled: false, nextPhase: 'nlu_required' }
    }

    if (selection === 0) {
      logger.info('Invalid selection', { attempts: state.attempts + 1 })
      state.attempts += 1
      if (state.attempts > 3) {
        return { handled: false, nextPhase: 'nlu_required' }
      }
      return { handled: true, nextPhase: 'awaiting_sede', error: 'Selección inválida' }
    }

    const selectedSede = sedes[selection - 1]
    state.sede = selectedSede.nombre
    state.phase = 'awaiting_search_type'
    state.attempts = 0

    const stateKey = `${EXISTING_PATIENT_FLOW_KEY}:${phoneNumber}`
    const redis = getRedisClient()
    if (redis) {
      await redis.setex(stateKey, EXISTING_PATIENT_FLOW_TTL, JSON.stringify(state))
    }

    logger.info('Sede selected', { sede: state.sede })

    return {
      handled: true,
      nextPhase: 'awaiting_search_type',
      data: { sede: selectedSede },
    }
  } catch (error) {
    logger.error('Error handling sede selection', error as Error)
    return { handled: false, error: 'Error procesando selección' }
  }
}

/**
 * Procesa mensaje en fase de selección de turno
 */
export async function handleTurnSelection(
  phoneNumber: string,
  userMessage: string,
  clientId: string
): Promise<{
  handled: boolean
  nextPhase?: string
  data?: any
  error?: string
}> {
  const logger = createConversationLogger(phoneNumber, clientId, 'existing_patient_turn')
  const state = await getExistingPatientState(phoneNumber)

  if (!state || state.phase !== 'awaiting_turn_selection' || !state.turnos) {
    return { handled: false }
  }

  // Extraer selección numérica
  const selection = extractNumberSelection(userMessage, state.turnos.length)

  if (selection === -1) {
    logger.info('Non-numeric input, requires NLU', {})
    return { handled: false, nextPhase: 'nlu_required' }
  }

  if (selection === 0) {
    logger.info('Invalid selection', { attempts: state.attempts + 1 })
    state.attempts += 1
    if (state.attempts > 3) {
      return { handled: false, nextPhase: 'nlu_required' }
    }
    return { handled: true, nextPhase: 'awaiting_turn_selection', error: 'Selección inválida' }
  }

  const selectedTurno = state.turnos[selection - 1]
  state.selectedTurno = selectedTurno
  state.phase = 'awaiting_confirmation'
  state.attempts = 0

  const stateKey = `${EXISTING_PATIENT_FLOW_KEY}:${phoneNumber}`
  const redis = getRedisClient()
  if (redis) {
    await redis.setex(stateKey, EXISTING_PATIENT_FLOW_TTL, JSON.stringify(state))
  }

  logger.info('Turn selected', { turnoId: selectedTurno.id })

  return {
    handled: true,
    nextPhase: 'awaiting_confirmation',
    data: { turno: selectedTurno },
  }
}

/**
 * Procesa confirmación final
 */
export async function handleConfirmation(
  phoneNumber: string,
  userMessage: string,
  clientId: string
): Promise<{
  handled: boolean
  confirmed: boolean
  nextPhase?: string
  data?: any
  error?: string
}> {
  const logger = createConversationLogger(phoneNumber, clientId, 'existing_patient_confirm')
  const state = await getExistingPatientState(phoneNumber)

  if (!state || state.phase !== 'awaiting_confirmation') {
    return { handled: false, confirmed: false }
  }

  // Buscar confirmación o cancelación
  const confirmPatterns = /^(1|si|sí|confirmo|ok|bueno)/i
  const cancelPatterns = /^(2|no|cancelo|volver)/i

  const isConfirm = confirmPatterns.test(userMessage.trim())
  const isCancel = cancelPatterns.test(userMessage.trim())

  if (!isConfirm && !isCancel) {
    logger.info('Ambiguous confirmation, requires NLU', {})
    return { handled: false, confirmed: false, nextPhase: 'nlu_required' }
  }

  if (isCancel) {
    logger.info('Confirmation cancelled', {})
    state.phase = 'initial'
    const stateKey = `${EXISTING_PATIENT_FLOW_KEY}:${phoneNumber}`
    const redis = getRedisClient()
    if (redis) {
      await redis.del(stateKey)
    }
    return { handled: true, confirmed: false, nextPhase: 'initial' }
  }

  // Procesamiento de confirmación (reserva)
  if (!state.selectedTurno) {
    logger.error('No turno selected', {})
    return { handled: false, confirmed: false, error: 'Error: No hay turno seleccionado' }
  }

  try {
    const clinicAPI = new ClinicAPI(clientId)

    // Reservar turno
    const reservaResponse = await clinicAPI.reservarTurno({
      turno_id: state.selectedTurno.id,
      paciente_id: state.patientId,
      email: state.patientEmail,
    })

    if (!reservaResponse.exito) {
      logger.warn('Reservation failed', { turnoId: state.selectedTurno.id })
      return {
        handled: true,
        confirmed: false,
        error: 'No se pudo reservar el turno. Intente nuevamente.',
        nextPhase: 'awaiting_turn_selection',
      }
    }

    state.phase = 'completed'
    const stateKey = `${EXISTING_PATIENT_FLOW_KEY}:${phoneNumber}`
    const redis = getRedisClient()
    if (redis) {
      await redis.setex(stateKey, 3600, JSON.stringify(state))
    }

    logger.info('Turn reserved successfully', {
      turnoId: state.selectedTurno.id,
      patientId: state.patientId,
    })

    return {
      handled: true,
      confirmed: true,
      nextPhase: 'completed',
      data: {
        reserva: reservaResponse.datos,
        turno: state.selectedTurno,
      },
    }
  } catch (error) {
    logger.error('Error during reservation', error as Error)
    return {
      handled: false,
      confirmed: false,
      error: 'Error del sistema al reservar',
    }
  }
}

/**
 * Obtiene el estado actual del flujo
 */
export async function getExistingPatientState(
  phoneNumber: string
): Promise<ExistingPatientFlowState | null> {
  const redis = getRedisClient()
  if (!redis) return null

  const stateKey = `${EXISTING_PATIENT_FLOW_KEY}:${phoneNumber}`
  const stateStr = await redis.get(stateKey)

  if (!stateStr) return null

  return JSON.parse(stateStr) as ExistingPatientFlowState
}

/**
 * Verifica si el flujo está activo
 */
export async function isExistingPatientFlowActive(phoneNumber: string): Promise<boolean> {
  const state = await getExistingPatientState(phoneNumber)
  return !!state && state.phase !== 'completed'
}

/**
 * Limpia el estado del flujo
 */
export async function clearExistingPatientFlow(phoneNumber: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  const stateKey = `${EXISTING_PATIENT_FLOW_KEY}:${phoneNumber}`
  await redis.del(stateKey)
}
