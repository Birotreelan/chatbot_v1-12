import { getRedisClient } from '@/lib/redis'
import { createConversationLogger } from '../logger'
import { ClinicAPI } from '../../clinic-api'

/**
 * New Patient Flow Handler
 * Gestiona el registro completo y reserva de turnos para pacientes nuevos
 */

const NEW_PATIENT_STATE_KEY = 'new_patient_flow'
const NEW_PATIENT_TTL = 86400 // 24 horas (antes 2h era muy corto para pacientes que tardan en responder)

interface NewPatientFlowState {
  phase: 'name_input' | 'health_insurance' | 'venue_selection' | 'search_type' | 
         'professional_search' | 'turn_selection' | 'email_confirmation' | 'final_confirmation' | 'completed'
  dni: string
  phone: string
  name?: string
  lastName?: string
  healthInsurance?: string
  healthInsuranceId?: string
  venueId?: string
  venueName?: string
  searchType?: '1' | '2' | '3' // 1=doctor, 2=specialty, 3=any
  professionalId?: string
  professionalName?: string
  specialtyId?: string
  specialtyName?: string
  turns?: any[]
  selectedTurnId?: string
  selectedTurnNumber?: number
  email?: string
  createdAt: number
  attempts: number
}

export async function startNewPatientFlow(
  dni: string,
  phone: string,
  clientId: string
): Promise<NewPatientFlowState> {
  const logger = createConversationLogger(phone, clientId, 'new_patient_initial')
  logger.info('Starting new patient flow', { dni, phone })

  const redis = getRedisClient()
  if (!redis) {
    logger.error('Redis unavailable', {})
    throw new Error('Redis unavailable')
  }

  const state: NewPatientFlowState = {
    phase: 'name_input',
    dni,
    phone,
    createdAt: Date.now(),
    attempts: 0,
  }

  await redis.setex(
    `${NEW_PATIENT_STATE_KEY}:${phone}`,
    NEW_PATIENT_TTL,
    JSON.stringify(state)
  )

  return state
}

export async function processNewPatientMessage(
  phone: string,
  userMessage: string,
  clientId: string
): Promise<{
  handled: boolean
  nextPhase?: string
  data?: any
}> {
  const logger = createConversationLogger(phone, clientId, 'new_patient_processing')
  logger.info('Processing message', { message: userMessage.substring(0, 50) })

  const redis = getRedisClient()
  if (!redis) {
    logger.error('Redis unavailable', {})
    return { handled: false }
  }

  const stateKey = `${NEW_PATIENT_STATE_KEY}:${phone}`
  const stateStr = await redis.get(stateKey)

  if (!stateStr) {
    logger.debug('No state found', { phone })
    return { handled: false }
  }

  const state: NewPatientFlowState = typeof stateStr === 'object'
    ? stateStr as NewPatientFlowState
    : JSON.parse(stateStr as string)

  switch (state.phase) {
    case 'name_input':
      return handleNameInput(userMessage, state, stateKey, phone, clientId, redis, logger)
    case 'health_insurance':
      return handleHealthInsurance(userMessage, state, stateKey, phone, clientId, redis, logger)
    case 'venue_selection':
      return handleVenueSelection(userMessage, state, stateKey, phone, clientId, redis, logger)
    case 'search_type':
      return handleSearchType(userMessage, state, stateKey, phone, clientId, redis, logger)
    case 'turn_selection':
      return handleTurnSelection(userMessage, state, stateKey, phone, clientId, redis, logger)
    case 'email_confirmation':
      return handleEmailConfirmation(userMessage, state, stateKey, phone, clientId, redis, logger)
    case 'final_confirmation':
      return handleFinalConfirmation(userMessage, state, stateKey, phone, clientId, redis, logger)
    default:
      logger.warn('Unknown phase', { phase: state.phase })
      return { handled: false }
  }
}

async function handleNameInput(
  message: string,
  state: NewPatientFlowState,
  stateKey: string,
  phone: string,
  clientId: string,
  redis: any,
  logger: any
): Promise<{ handled: boolean; nextPhase?: string }> {
  const parts = message.trim().split(/\s+/)
  if (parts.length < 2) {
    return { handled: false, nextPhase: 'invalid_name' }
  }

  state.name = parts[0]
  state.lastName = parts.slice(1).join(' ')
  state.phase = 'health_insurance'
  state.attempts = 0

  await redis.setex(stateKey, NEW_PATIENT_TTL, JSON.stringify(state))
  logger.info('Name captured', { name: state.name, lastName: state.lastName })

  return { handled: true, nextPhase: 'health_insurance' }
}

async function handleHealthInsurance(
  message: string,
  state: NewPatientFlowState,
  stateKey: string,
  phone: string,
  clientId: string,
  redis: any,
  logger: any
): Promise<{ handled: boolean; nextPhase?: string }> {
  const clinicAPI = new ClinicAPI(clientId)
  
  try {
    const result = await clinicAPI.validarObraSocial(message)
    
    if (!result.exito) {
      return { handled: false, nextPhase: 'invalid_health_insurance' }
    }

    state.healthInsurance = result.datos.nombre
    state.healthInsuranceId = result.datos.id
    state.phase = 'venue_selection'
    state.attempts = 0

    await redis.setex(stateKey, NEW_PATIENT_TTL, JSON.stringify(state))
    logger.info('Health insurance validated', { healthInsurance: state.healthInsurance })

    return { handled: true, nextPhase: 'venue_selection' }
  } catch (error) {
    logger.error('Health insurance validation error', error as Error)
    return { handled: false, nextPhase: 'nlu_required' }
  }
}

async function handleVenueSelection(
  message: string,
  state: NewPatientFlowState,
  stateKey: string,
  phone: string,
  clientId: string,
  redis: any,
  logger: any
): Promise<{ handled: boolean; nextPhase?: string }> {
  const num = parseInt(message.trim(), 10)
  if (isNaN(num)) {
    return { handled: false, nextPhase: 'invalid_venue' }
  }

  // Aquí se buscaría la sede del estado.venues_options
  // Simplificado: solo procesamos el número
  state.venueId = `venue_${num}`
  state.phase = 'search_type'
  state.attempts = 0

  await redis.setex(stateKey, NEW_PATIENT_TTL, JSON.stringify(state))
  logger.info('Venue selected', { venueId: state.venueId })

  return { handled: true, nextPhase: 'search_type' }
}

async function handleSearchType(
  message: string,
  state: NewPatientFlowState,
  stateKey: string,
  phone: string,
  clientId: string,
  redis: any,
  logger: any
): Promise<{ handled: boolean; nextPhase?: string }> {
  const choice = message.trim()
  if (!['1', '2', '3'].includes(choice)) {
    return { handled: false, nextPhase: 'invalid_search_type' }
  }

  state.searchType = choice as '1' | '2' | '3'
  state.phase = choice === '1' ? 'professional_search' : 'turn_selection'
  state.attempts = 0

  await redis.setex(stateKey, NEW_PATIENT_TTL, JSON.stringify(state))
  logger.info('Search type selected', { searchType: state.searchType })

  return { handled: true, nextPhase: state.phase }
}

async function handleTurnSelection(
  message: string,
  state: NewPatientFlowState,
  stateKey: string,
  phone: string,
  clientId: string,
  redis: any,
  logger: any
): Promise<{ handled: boolean; nextPhase?: string }> {
  const num = parseInt(message.trim(), 10)
  if (isNaN(num)) {
    return { handled: false, nextPhase: 'invalid_turn' }
  }

  state.selectedTurnNumber = num
  state.phase = 'email_confirmation'
  state.attempts = 0

  await redis.setex(stateKey, NEW_PATIENT_TTL, JSON.stringify(state))
  logger.info('Turn selected', { turnNumber: state.selectedTurnNumber })

  return { handled: true, nextPhase: 'email_confirmation' }
}

async function handleEmailConfirmation(
  message: string,
  state: NewPatientFlowState,
  stateKey: string,
  phone: string,
  clientId: string,
  redis: any,
  logger: any
): Promise<{ handled: boolean; nextPhase?: string }> {
  const email = message.trim()
  if (!email.includes('@')) {
    return { handled: false, nextPhase: 'invalid_email' }
  }

  state.email = email
  state.phase = 'final_confirmation'
  state.attempts = 0

  await redis.setex(stateKey, NEW_PATIENT_TTL, JSON.stringify(state))
  logger.info('Email confirmed', { email })

  return { handled: true, nextPhase: 'final_confirmation' }
}

async function handleFinalConfirmation(
  message: string,
  state: NewPatientFlowState,
  stateKey: string,
  phone: string,
  clientId: string,
  redis: any,
  logger: any
): Promise<{ handled: boolean; nextPhase?: string }> {
  const response = message.trim().toLowerCase()
  if (!['1', 'si', 'sí', 'yes', 'confirmar'].includes(response)) {
    return { handled: false, nextPhase: 'confirmation_rejected' }
  }

  state.phase = 'completed'

  await redis.setex(stateKey, 3600, JSON.stringify(state))
  logger.info('Booking confirmed and completed', {})

  return { handled: true, nextPhase: 'completed', data: state }
}

export async function getNewPatientState(phone: string): Promise<NewPatientFlowState | null> {
  const redis = getRedisClient()
  if (!redis) return null

  const stateStr = await redis.get(`${NEW_PATIENT_STATE_KEY}:${phone}`)
  if (!stateStr) return null

  if (typeof stateStr === 'object') return stateStr as NewPatientFlowState
  return JSON.parse(stateStr as string) as NewPatientFlowState
}

export async function isNewPatientFlowActive(phone: string): Promise<boolean> {
  const state = await getNewPatientState(phone)
  return !!state && state.phase !== 'completed'
}

export async function clearNewPatientFlow(phone: string, clientId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  const logger = createConversationLogger(phone, clientId, 'new_patient_initial')
  await redis.del(`${NEW_PATIENT_STATE_KEY}:${phone}`)
  logger.info('Flow cleared', {})
}
