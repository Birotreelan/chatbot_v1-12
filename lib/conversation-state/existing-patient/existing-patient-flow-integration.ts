/**
 * Integracion del flujo de paciente existente
 * Usa modulos compartidos para reutilizacion de codigo con paciente nuevo
 */

import { getRedisClient } from '@/lib/redis'
import { createConversationLogger } from '../logger'
import { getEffectiveFeatureFlags } from '../feature-flags'
import { getDetectedPatientInfo } from '../patient-detection/patient-flow-handler'
import { ClinicAPI } from '@/lib/clinic-api'

// Importar handlers compartidos
import {
  fetchSedes,
  buildSedesMessage,
  handleSedeSelection as handleSedeSelectionShared,
  buildSedesErrorMessage,
} from '../shared/sede-handler'
import {
  buildSearchOptionsMessage,
  handleSearchTypeSelection,
  buildProfessionalNameRequestMessage,
} from '../shared/search-options-handler'
import {
  fetchSpecialties,
  buildSpecialtiesMessage,
  handleSpecialtySelection,
  buildSpecialtiesErrorMessage,
} from '../shared/specialty-handler'
import {
  searchProfessionals,
  buildProfessionalsListMessage,
  handleProfessionalSelection,
  handleProfessionalNameInput,
} from '../shared/professional-handler'
import {
  searchTurnosAcumulativo,
  buildTurnosListMessage,
  buildNoTurnosMessage,
} from '../shared/turnos-handler'
import {
  handleTurnoSelection,
  buildTurnoSelectedMessage,
} from '../shared/turno-selection-handler'
import {
  shouldRequestEmail,
  buildEmailRequestMessage,
  handleEmailInput as handleEmailInputShared,
  validateEmail,
} from '../shared/email-handler'
import {
  buildConfirmationMessage,
  handleConfirmationResponse,
  executeReservation,
} from '../shared/confirmation-handler'
import type {
  SedeOption,
  SpecialtyOption,
  ProfessionalOption,
  TurnoOption,
  FlowPhase,
} from '../shared/types'

// Constantes
const EXISTING_PATIENT_FLOW_KEY = 'existing_patient_flow'
const EXISTING_PATIENT_FLOW_TTL = 7200 // 2 horas

// Estado del flujo
export interface ExistingPatientFlowState {
  phase: FlowPhase
  patientId: string
  patientName: string
  patientFirstName?: string  // Nombre separado para reservas
  patientLastName?: string   // Apellido separado para reservas
  patientDNI: string
  patientEmail?: string
  patientPhone: string

  // Obra social (del paciente existente)
  obraSocialId?: string
  obraSocialNombre?: string

  // Sede
  sedeId?: string
  sedeNombre?: string
  sedesOpciones?: SedeOption[]

  // Busqueda
  searchType?: 'medico_particular' | 'especialidad' | 'cualquier_medico'

  // Profesional
  profesionalId?: string
  profesionalNombre?: string
  profesionalesOpciones?: ProfessionalOption[]

  // Especialidad
  especialidadId?: string
  especialidadNombre?: string
  especialidadesOpciones?: SpecialtyOption[]

  // Turnos
  turnosOpciones?: TurnoOption[]
  turnoSeleccionado?: TurnoOption

  // Control
  attempts: number
  createdAt: number
  lastUpdated: number
}

export interface ExistingPatientResult {
  handled: boolean
  message?: string
  action?: string
  nextPhase?: string
  shouldCallOpenAI?: boolean
  openAIContext?: string
}

/**
 * Obtiene el estado del flujo desde Redis
 */
async function getFlowState(phoneNumber: string): Promise<ExistingPatientFlowState | null> {
  const redis = getRedisClient()
  if (!redis) return null

  const stateKey = `${EXISTING_PATIENT_FLOW_KEY}:${phoneNumber}`
  const stateStr = await redis.get(stateKey)
  if (!stateStr) return null

  return typeof stateStr === 'object' ? stateStr as ExistingPatientFlowState : JSON.parse(stateStr as string)
}

/**
 * Guarda el estado del flujo en Redis
 */
async function saveFlowState(phoneNumber: string, state: ExistingPatientFlowState): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  state.lastUpdated = Date.now()
  const stateKey = `${EXISTING_PATIENT_FLOW_KEY}:${phoneNumber}`
  await redis.setex(stateKey, EXISTING_PATIENT_FLOW_TTL, JSON.stringify(state))
}

/**
 * Inicializa el flujo de paciente existente
 */
export async function initializeExistingPatientFlow(
  phoneNumber: string,
  patientId: string,
  patientName: string,
  patientDNI: string,
  patientEmail: string | undefined,
  clientId: string
): Promise<ExistingPatientResult> {
  const logger = createConversationLogger(phoneNumber, clientId, 'existing_patient_init')
  logger.info('Initializing existing patient flow', { patientId, patientName })

  const flags = await getEffectiveFeatureFlags(clientId)
  if (!flags.directPacienteExistente) {
    return {
      handled: false,
      shouldCallOpenAI: true,
      openAIContext: 'Use route_to_pacienteExistente',
    }
  }

  // Obtener datos completos del paciente desde el estado de deteccion si faltan
  let finalPatientDNI = patientDNI
  let finalPatientFirstName: string | undefined
  let finalPatientLastName: string | undefined
  
  if (!patientDNI || patientDNI === '') {
    const detectedInfo = await getDetectedPatientInfo(phoneNumber)
    if (detectedInfo) {
      finalPatientDNI = detectedInfo.patientDNI || ''
      finalPatientFirstName = detectedInfo.patientFirstName
      finalPatientLastName = detectedInfo.patientLastName
      logger.info('Retrieved patient data from detection state', {
        dni: finalPatientDNI,
        firstName: finalPatientFirstName,
        lastName: finalPatientLastName,
      })
    }
  }

  // Obtener sedes desde la API
  const sedesResult = await fetchSedes(clientId)
  if (!sedesResult.success || !sedesResult.sedes) {
    logger.error('Error fetching sedes', new Error(sedesResult.error || 'Unknown error'))
    return {
      handled: true,
      message: buildSedesErrorMessage(),
      nextPhase: 'error',
    }
  }

  // Crear estado inicial
  const state: ExistingPatientFlowState = {
    phase: 'awaiting_sede',
    patientId,
    patientName,
    patientFirstName: finalPatientFirstName,
    patientLastName: finalPatientLastName,
    patientDNI: finalPatientDNI,
    patientEmail,
    patientPhone: phoneNumber,
    sedesOpciones: sedesResult.sedes,
    attempts: 0,
    createdAt: Date.now(),
    lastUpdated: Date.now(),
  }

  await saveFlowState(phoneNumber, state)

  // Construir mensaje de bienvenida + sedes
  const primerNombre = patientName.split(' ')[0]
  const welcomeMessage = `Hola ${primerNombre}, te ayudo a agendar un nuevo turno.`
  const sedesMessage = buildSedesMessage(sedesResult.sedes)

  logger.info('Flow initialized', { sedesCount: sedesResult.sedes.length })

  return {
    handled: true,
    message: `${welcomeMessage}\n\n${sedesMessage}`,
    nextPhase: 'awaiting_sede',
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

  const state = await getFlowState(phoneNumber)
  if (!state) {
    return { handled: false, shouldCallOpenAI: true }
  }

  logger.info('Processing message', { phase: state.phase, message: userMessage.substring(0, 50) })

  // Router por fase
  switch (state.phase) {
    case 'awaiting_sede':
      return handleSedePhase(phoneNumber, userMessage, clientId, state)

    case 'awaiting_search_type':
      return handleSearchTypePhase(phoneNumber, userMessage, clientId, state)

    case 'awaiting_professional_name':
      return handleProfessionalNamePhase(phoneNumber, userMessage, clientId, state)

    case 'awaiting_professional_selection':
      return handleProfessionalSelectionPhase(phoneNumber, userMessage, clientId, state)

    case 'awaiting_specialty_selection':
      return handleSpecialtyPhase(phoneNumber, userMessage, clientId, state)

    case 'awaiting_turno_selection':
      return handleTurnoPhase(phoneNumber, userMessage, clientId, state)

    case 'awaiting_email':
      return handleEmailPhase(phoneNumber, userMessage, clientId, state)

    case 'awaiting_confirmation':
      return handleConfirmationPhase(phoneNumber, userMessage, clientId, state)

    default:
      logger.warn('Unhandled phase', { phase: state.phase })
      return { handled: false, shouldCallOpenAI: true }
  }
}

/**
 * Fase: Seleccion de sede
 */
async function handleSedePhase(
  phoneNumber: string,
  userMessage: string,
  clientId: string,
  state: ExistingPatientFlowState
): Promise<ExistingPatientResult> {
  const logger = createConversationLogger(phoneNumber, clientId, 'sede_phase')

  if (!state.sedesOpciones || state.sedesOpciones.length === 0) {
    return { handled: false, shouldCallOpenAI: true }
  }

  const result = await handleSedeSelectionShared(userMessage, state.sedesOpciones, phoneNumber, clientId)

  if (result.selectedSede) {
    state.sedeId = result.selectedSede.id
    state.sedeNombre = result.selectedSede.nombre
    state.phase = 'awaiting_search_type'
    state.attempts = 0
    await saveFlowState(phoneNumber, state)

    logger.info('Sede selected', { sedeId: state.sedeId, sedeName: state.sedeNombre })

    return {
      handled: true,
      message: buildSearchOptionsMessage(state.sedeNombre),
      nextPhase: 'awaiting_search_type',
    }
  }

  // Seleccion invalida
  state.attempts += 1
  await saveFlowState(phoneNumber, state)

  return {
    handled: true,
    message: result.message,
    nextPhase: 'awaiting_sede',
  }
}

/**
 * Fase: Tipo de busqueda
 */
async function handleSearchTypePhase(
  phoneNumber: string,
  userMessage: string,
  clientId: string,
  state: ExistingPatientFlowState
): Promise<ExistingPatientResult> {
  const logger = createConversationLogger(phoneNumber, clientId, 'search_type_phase')

  const result = await handleSearchTypeSelection(userMessage, phoneNumber, clientId)

  if (result.searchType) {
    state.searchType = result.searchType
    state.attempts = 0

    if (result.searchType === 'medico_particular') {
      state.phase = 'awaiting_professional_name'
      await saveFlowState(phoneNumber, state)
      return {
        handled: true,
        message: buildProfessionalNameRequestMessage(),
        nextPhase: 'awaiting_professional_name',
      }
    }

    if (result.searchType === 'especialidad') {
      // Obtener especialidades
      const espResult = await fetchSpecialties(clientId)
      if (!espResult.success || !espResult.especialidades) {
        return {
          handled: true,
          message: buildSpecialtiesErrorMessage(),
          nextPhase: 'error',
        }
      }

      state.especialidadesOpciones = espResult.especialidades
      state.phase = 'awaiting_specialty_selection'
      await saveFlowState(phoneNumber, state)

      return {
        handled: true,
        message: buildSpecialtiesMessage(espResult.especialidades),
        nextPhase: 'awaiting_specialty_selection',
      }
    }

    if (result.searchType === 'cualquier_medico') {
      // Buscar turnos sin filtro de profesional
      return await searchAndShowTurnos(phoneNumber, clientId, state)
    }
  }

  // Input no reconocido
  return {
    handled: true,
    message: result.message,
    nextPhase: 'awaiting_search_type',
  }
}

/**
 * Fase: Nombre del profesional
 */
async function handleProfessionalNamePhase(
  phoneNumber: string,
  userMessage: string,
  clientId: string,
  state: ExistingPatientFlowState
): Promise<ExistingPatientResult> {
  const logger = createConversationLogger(phoneNumber, clientId, 'professional_name_phase')

  const result = await handleProfessionalNameInput(userMessage, clientId, phoneNumber)

  if (result.profesionales && result.profesionales.length > 0) {
    state.profesionalesOpciones = result.profesionales

    if (result.profesionales.length === 1) {
      // Un solo profesional encontrado, seleccionar automaticamente
      state.profesionalId = result.profesionales[0].id
      state.profesionalNombre = result.profesionales[0].nombre
      state.phase = 'awaiting_turno_selection'
      await saveFlowState(phoneNumber, state)

      return await searchAndShowTurnos(phoneNumber, clientId, state)
    }

    // Multiples profesionales, mostrar lista
    state.phase = 'awaiting_professional_selection'
    await saveFlowState(phoneNumber, state)

    return {
      handled: true,
      message: result.message,
      nextPhase: 'awaiting_professional_selection',
    }
  }

  return {
    handled: true,
    message: result.message,
    nextPhase: 'awaiting_professional_name',
  }
}

/**
 * Fase: Seleccion de profesional
 */
async function handleProfessionalSelectionPhase(
  phoneNumber: string,
  userMessage: string,
  clientId: string,
  state: ExistingPatientFlowState
): Promise<ExistingPatientResult> {
  if (!state.profesionalesOpciones) {
    return { handled: false, shouldCallOpenAI: true }
  }

  const result = await handleProfessionalSelection(userMessage, state.profesionalesOpciones, phoneNumber, clientId)

  if (result.selectedProfessional) {
    state.profesionalId = result.selectedProfessional.id
    state.profesionalNombre = result.selectedProfessional.nombre
    state.attempts = 0
    await saveFlowState(phoneNumber, state)

    return await searchAndShowTurnos(phoneNumber, clientId, state)
  }

  return {
    handled: true,
    message: result.message,
    nextPhase: 'awaiting_professional_selection',
  }
}

/**
 * Fase: Seleccion de especialidad
 */
async function handleSpecialtyPhase(
  phoneNumber: string,
  userMessage: string,
  clientId: string,
  state: ExistingPatientFlowState
): Promise<ExistingPatientResult> {
  if (!state.especialidadesOpciones) {
    return { handled: false, shouldCallOpenAI: true }
  }

  const result = await handleSpecialtySelection(userMessage, state.especialidadesOpciones, phoneNumber, clientId)

  if (result.selectedSpecialty) {
    state.especialidadId = result.selectedSpecialty.id
    state.especialidadNombre = result.selectedSpecialty.nombre
    state.attempts = 0
    await saveFlowState(phoneNumber, state)

    return await searchAndShowTurnos(phoneNumber, clientId, state)
  }

  return {
    handled: true,
    message: result.message,
    nextPhase: 'awaiting_specialty_selection',
  }
}

/**
 * Busca turnos y los muestra
 */
async function searchAndShowTurnos(
  phoneNumber: string,
  clientId: string,
  state: ExistingPatientFlowState
): Promise<ExistingPatientResult> {
  const logger = createConversationLogger(phoneNumber, clientId, 'turnos_search')

  logger.info('Searching turnos', {
    sedeId: state.sedeId,
    profesionalId: state.profesionalId,
    especialidadId: state.especialidadId,
  })

  const result = await searchTurnosAcumulativo(
    clientId,
    {
      sedeId: state.sedeId!,
      pacienteDNI: state.patientDNI, // Paciente existente usa DNI
      profesionalId: state.profesionalId,
      especialidadId: state.especialidadId,
    },
    phoneNumber
  )

  if (!result.success || !result.turnos || result.turnos.length === 0) {
    return {
      handled: true,
      message: buildNoTurnosMessage(state.sedeNombre, state.profesionalNombre, state.especialidadNombre),
      nextPhase: 'awaiting_search_type', // Volver a opciones de busqueda
    }
  }

  state.turnosOpciones = result.turnos
  state.phase = 'awaiting_turno_selection'
  await saveFlowState(phoneNumber, state)

  logger.info('Turnos found', { count: result.turnos.length, rango: result.rangoUtilizado })

  return {
    handled: true,
    message: buildTurnosListMessage(result.turnos, state.patientName, state.sedeNombre),
    nextPhase: 'awaiting_turno_selection',
  }
}

/**
 * Fase: Seleccion de turno
 */
async function handleTurnoPhase(
  phoneNumber: string,
  userMessage: string,
  clientId: string,
  state: ExistingPatientFlowState
): Promise<ExistingPatientResult> {
  if (!state.turnosOpciones) {
    return { handled: false, shouldCallOpenAI: true }
  }

  const result = await handleTurnoSelection(userMessage, state.turnosOpciones, phoneNumber, clientId)

  if (result.selectedTurno) {
    state.turnoSeleccionado = result.selectedTurno
    state.attempts = 0

    // Verificar si necesita email
    if (shouldRequestEmail(state.patientEmail)) {
      state.phase = 'awaiting_email'
      await saveFlowState(phoneNumber, state)

      const turnoMsg = buildTurnoSelectedMessage(result.selectedTurno)
      const emailMsg = buildEmailRequestMessage()

      return {
        handled: true,
        message: `${turnoMsg}\n\n${emailMsg}`,
        nextPhase: 'awaiting_email',
      }
    }

    // Ya tiene email, ir a confirmacion
    state.phase = 'awaiting_confirmation'
    await saveFlowState(phoneNumber, state)

    return {
      handled: true,
      message: buildConfirmationMessage(
        result.selectedTurno,
        state.patientName,
        state.sedeNombre,
        state.obraSocialNombre
      ),
      nextPhase: 'awaiting_confirmation',
    }
  }

  return {
    handled: true,
    message: result.message,
    nextPhase: 'awaiting_turno_selection',
  }
}

/**
 * Fase: Email
 */
async function handleEmailPhase(
  phoneNumber: string,
  userMessage: string,
  clientId: string,
  state: ExistingPatientFlowState
): Promise<ExistingPatientResult> {
  const result = await handleEmailInputShared(userMessage, phoneNumber, clientId, state.attempts)

  if (result.validatedEmail) {
    state.patientEmail = result.validatedEmail
    state.phase = 'awaiting_confirmation'
    state.attempts = 0
    await saveFlowState(phoneNumber, state)

    return {
      handled: true,
      message: buildConfirmationMessage(
        state.turnoSeleccionado!,
        state.patientName,
        state.sedeNombre,
        state.obraSocialNombre
      ),
      nextPhase: 'awaiting_confirmation',
    }
  }

  if (result.nextPhase === 'abandoned') {
    await clearExistingPatientFlow(phoneNumber)
    return {
      handled: true,
      message: result.message,
      nextPhase: 'abandoned',
    }
  }

  state.attempts += 1
  await saveFlowState(phoneNumber, state)

  return {
    handled: true,
    message: result.message,
    nextPhase: 'awaiting_email',
  }
}

/**
 * Fase: Confirmacion
 */
async function handleConfirmationPhase(
  phoneNumber: string,
  userMessage: string,
  clientId: string,
  state: ExistingPatientFlowState
): Promise<ExistingPatientResult> {
  const logger = createConversationLogger(phoneNumber, clientId, 'confirmation_phase')

  const result = await handleConfirmationResponse(userMessage, phoneNumber, clientId)

  if (result.confirmed === true) {
    // Extraer nombre y apellido: usar campos separados si existen,
    // o derivarlos de patientName como fallback (formato: "Nombres Apellido")
    let nombreParaReserva = state.patientFirstName
    let apellidoParaReserva = state.patientLastName
    let dniParaReserva = state.patientDNI

    // Si faltan datos, obtenerlos del estado de detección del paciente
    if (!nombreParaReserva || !apellidoParaReserva || !dniParaReserva) {
      const detectedInfo = await getDetectedPatientInfo(phoneNumber)
      if (detectedInfo) {
        if (!nombreParaReserva) nombreParaReserva = detectedInfo.patientFirstName || ''
        if (!apellidoParaReserva) apellidoParaReserva = detectedInfo.patientLastName || ''
        if (!dniParaReserva) dniParaReserva = detectedInfo.patientDNI || ''
        
        logger.info('Retrieved missing patient data from detection state for reservation', {
          firstName: nombreParaReserva,
          lastName: apellidoParaReserva,
          dni: dniParaReserva,
        })
      }
    }

    // Fallback final: si aún falta el DNI, obtener datos frescos de la API usando el teléfono
    if (!dniParaReserva) {
      logger.info('DNI still missing, fetching fresh patient data from API', { phone: phoneNumber })
      try {
        const clinicAPI = new ClinicAPI(clientId)
        const pacienteResponse = await clinicAPI.paciente_telefono(phoneNumber)
        
        if (pacienteResponse.exito && pacienteResponse.datos) {
          const paciente = pacienteResponse.datos.paciente || pacienteResponse.datos
          dniParaReserva = (paciente.Nrodoc || paciente.dni || '').toString()
          if (!nombreParaReserva) nombreParaReserva = paciente.Nombres || paciente.nombres || ''
          if (!apellidoParaReserva) apellidoParaReserva = paciente.Apellido || paciente.apellido || ''
          
          logger.info('Retrieved patient data from API for reservation', {
            firstName: nombreParaReserva,
            lastName: apellidoParaReserva,
            dni: dniParaReserva,
          })
        }
      } catch (error) {
        logger.error('Error fetching patient data from API', error instanceof Error ? error : new Error(String(error)))
      }
    }

    // Fallback: derivar nombre/apellido de patientName si aún faltan
    if (!nombreParaReserva && state.patientName) {
      const partes = state.patientName.trim().split(' ')
      if (partes.length >= 2) {
        apellidoParaReserva = partes[partes.length - 1]
        nombreParaReserva = partes.slice(0, partes.length - 1).join(' ')
      } else {
        nombreParaReserva = state.patientName.trim()
      }
    }

    // Ejecutar reserva
    const reservaResult = await executeReservation(
      clientId,
      state.turnoSeleccionado!,
      {
        nombre: nombreParaReserva,
        apellido: apellidoParaReserva,
        dni: dniParaReserva,
        telefono: state.patientPhone,
        email: state.patientEmail!,
        obraSocialId: state.obraSocialId,
        obraSocialNombre: state.obraSocialNombre,
      },
      phoneNumber
    )

    if (reservaResult.success) {
      state.phase = 'completed'
      await saveFlowState(phoneNumber, state)

      logger.info('Reserva exitosa', { turnoId: state.turnoSeleccionado?.id })

      return {
        handled: true,
        message: reservaResult.message,
        action: 'turno_reservado',
        nextPhase: 'completed',
      }
    }

    // Error en reserva
    logger.error('Error en reserva', new Error(String(reservaResult.error) || 'Unknown reservation error'))
    return {
      handled: true,
      message: reservaResult.message,
      nextPhase: 'awaiting_turno_selection', // Permitir elegir otro turno
    }
  }

  if (result.confirmed === false && result.nextPhase === 'abandoned') {
    await clearExistingPatientFlow(phoneNumber)
    return {
      handled: true,
      message: result.message,
      nextPhase: 'abandoned',
    }
  }

  return {
    handled: true,
    message: result.message,
    nextPhase: 'awaiting_confirmation',
  }
}

/**
 * Verifica si el flujo esta activo
 */
export async function isExistingPatientFlowActive(phoneNumber: string): Promise<boolean> {
  const state = await getFlowState(phoneNumber)
  return !!state && state.phase !== 'completed' && state.phase !== 'abandoned'
}

/**
 * Obtiene la fase actual del flujo (para verificar si está más avanzado que awaiting_sede)
 */
export async function getExistingPatientFlowPhase(phoneNumber: string): Promise<string | null> {
  const state = await getFlowState(phoneNumber)
  if (!state || state.phase === 'completed' || state.phase === 'abandoned') {
    return null
  }
  return state.phase
}

/**
 * Limpia el flujo
 */
export async function clearExistingPatientFlow(phoneNumber: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  await redis.del(`${EXISTING_PATIENT_FLOW_KEY}:${phoneNumber}`)
}

/**
 * Verifica si debe usar el flujo directo
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
