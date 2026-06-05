/**
 * Integracion del flujo de paciente existente
 * Usa modulos compartidos para reutilizacion de codigo con paciente nuevo
 */

import { getRedisClient } from '@/lib/redis'
import { createConversationLogger } from '../logger'
import { getEffectiveFeatureFlags } from '../feature-flags'
import { getDetectedPatientInfo } from '../patient-detection/patient-flow-handler'
import { validarObraSocial } from '@/lib/api-tools/api-functions' // 🆕 IMPORT PARA VALIDAR OBRA SOCIAL
import { getFirstName } from '@/lib/utils/name-utils'

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
  type SearchOptionsConfig,
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
 * Helper para enriquecer datos del paciente desde la API, manejando el caso de pacientes_multiples
 */
async function enrichPatientDataFromAPI(
  state: ExistingPatientFlowState,
  phoneNumber: string,
  clientId: string,
  logger: ReturnType<typeof createConversationLogger>
): Promise<void> {
  try {
    const clinicAPI = new ClinicAPI(clientId)
    const pacienteResponse = await clinicAPI.paciente_telefono(phoneNumber)
    
    if (pacienteResponse.exito && pacienteResponse.datos) {
      let paciente: Record<string, unknown> | null = null
      
      // Manejar caso de pacientes_multiples: filtrar por DNI o por patientId
      if (pacienteResponse.datos.warning === 'pacientes_multiples' && Array.isArray(pacienteResponse.datos.pacientes)) {
        const pacientes = pacienteResponse.datos.pacientes
        logger.info('Multiple patients found when enriching', { 
          totalPacientes: pacientes.length,
          stateDNI: state.patientDNI,
          statePatientId: state.patientId
        })
        
        // Intentar filtrar por DNI primero
        if (state.patientDNI) {
          const foundByDNI = pacientes.find((p: Record<string, unknown>) => 
            String(p.Nrodoc || p.nrodoc || p.dni || '').trim() === state.patientDNI.trim()
          )
          if (foundByDNI) {
            paciente = foundByDNI as Record<string, unknown>
            logger.info('Found patient by DNI for enrichment', { dni: state.patientDNI })
          } else {
            logger.warn('Could not find patient by DNI in multiple patients list', { dni: state.patientDNI })
          }
        }
        
        // Si no se encontró por DNI, intentar filtrar por patientId
        if (!paciente && state.patientId) {
          const foundById = pacientes.find((p: Record<string, unknown>) => 
            String(p.Id || p.id || '').trim() === state.patientId.trim()
          )
          if (foundById) {
            paciente = foundById as Record<string, unknown>
            logger.info('Found patient by patientId for enrichment', { patientId: state.patientId })
          } else {
            logger.warn('Could not find patient by patientId in multiple patients list', { patientId: state.patientId })
          }
        }
        
        if (!paciente) {
          logger.warn('Cannot identify patient from multiple patients list (no DNI or patientId match)')
        }
      } else {
        // Caso normal: un solo paciente
        paciente = (pacienteResponse.datos.paciente || pacienteResponse.datos) as Record<string, unknown>
      }
      
      if (paciente) {
        if (!state.patientFirstName) state.patientFirstName = String(paciente.Nombres || paciente.nombres || '').trim()
        if (!state.patientLastName) state.patientLastName = String(paciente.Apellido || paciente.apellido || '').trim()
        if (!state.patientDNI) state.patientDNI = String(paciente.Nrodoc || paciente.dni || '').trim()
        if (!state.patientEmail) state.patientEmail = String(paciente.Mail || paciente.mail || paciente.Email || paciente.email || '').trim()
        if (state.patientEmail === '-') state.patientEmail = ''
        if (!state.obraSocialId) state.obraSocialId = String(paciente.Deudor_Id || paciente.deudor_id || '')
        if (!state.obraSocialNombre) state.obraSocialNombre = String(paciente.Deudor_Nombre || paciente.deudor_nombre || '')
        
        logger.info('Enriched patient data from API', {
          firstName: state.patientFirstName,
          lastName: state.patientLastName,
          dni: state.patientDNI,
          obraSocialNombre: state.obraSocialNombre,
        })
      } else {
        logger.warn('Could not find matching patient in API response for enrichment')
      }
    }
  } catch (err) {
    logger.error('Error enriching patient data from API', err instanceof Error ? err : new Error(String(err)))
  }
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
  clientId: string,
  additionalPatientData?: {
    patientFirstName?: string
    patientLastName?: string
    obraSocialId?: string
    obraSocialNombre?: string
  },
  escalationPhoneNumber?: string
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

  // Usar datos pasados como parametro primero, luego intentar del estado de deteccion
  let finalPatientDNI = patientDNI || ''
  let finalPatientFirstName = additionalPatientData?.patientFirstName
  let finalPatientLastName = additionalPatientData?.patientLastName
  let finalObraSocialId = additionalPatientData?.obraSocialId
  let finalObraSocialNombre = additionalPatientData?.obraSocialNombre
  
  // Solo consultar estado de detección si faltan datos
  if (!finalPatientDNI || !finalPatientFirstName || !finalPatientLastName || !finalObraSocialId) {
    const detectedInfo = await getDetectedPatientInfo(phoneNumber)
    if (detectedInfo) {
      if (!finalPatientDNI) finalPatientDNI = detectedInfo.patientDNI || ''
      if (!finalPatientFirstName) finalPatientFirstName = detectedInfo.patientFirstName
      if (!finalPatientLastName) finalPatientLastName = detectedInfo.patientLastName
      if (!finalObraSocialId) finalObraSocialId = detectedInfo.obraSocialId
      if (!finalObraSocialNombre) finalObraSocialNombre = detectedInfo.obraSocialNombre
      logger.info('Retrieved missing patient data from detection state', {
        dni: finalPatientDNI,
        firstName: finalPatientFirstName,
        lastName: finalPatientLastName,
        obraSocialId: finalObraSocialId,
        obraSocialNombre: finalObraSocialNombre,
      })
    }
  }
  
  logger.info('Final patient data for flow', {
    dni: finalPatientDNI,
    firstName: finalPatientFirstName,
    lastName: finalPatientLastName,
    obraSocialId: finalObraSocialId,
    obraSocialNombre: finalObraSocialNombre,
  })

  // 🆕 VALIDAR SI LA OBRA SOCIAL PERMITE TURNOS ONLINE
  if (finalObraSocialNombre) {
    try {
      const obraSocialValidation = await validarObraSocial(clientId, finalObraSocialNombre)
      
      if (obraSocialValidation.exito && obraSocialValidation.datos.obras_sociales.length > 0) {
        const obraSocial = obraSocialValidation.datos.obras_sociales[0]
        
        if (obraSocial.permite_turnos_online === false) {
          const numeroDerivacion = escalationPhoneNumber || '[NÚMERO DE DERIVACIÓN]'
          logger.warn('Obra social de paciente existente no permite turnos online', {
            obraSocialId: finalObraSocialId,
            obraSocialNombre: finalObraSocialNombre,
          })
          
          return {
            handled: true,
            message: `Hola ${getFirstName(finalPatientFirstName)}. Lamentablemente, tu obra social (${finalObraSocialNombre}) no está habilitada para agendar turnos por este medio.

Para agendar tu turno, por favor contactanos al: *${numeroDerivacion}*`,
            action: 'obra_social_no_permite_turnos_online',
          }
        }
      }
    } catch (error) {
      logger.warn('Error validating obra social for existing patient', error as Error)
      // Continuar aunque falle la validación
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
    obraSocialId: finalObraSocialId,
    obraSocialNombre: finalObraSocialNombre,
    sedesOpciones: sedesResult.sedes,
    attempts: 0,
    createdAt: Date.now(),
    lastUpdated: Date.now(),
  }

  await saveFlowState(phoneNumber, state)

  // Construir mensaje de bienvenida + sedes
  const primerNombre = getFirstName(patientName)
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
  clientId: string,
  escalationPhoneNumber?: string,
  searchOptionsConfig?: SearchOptionsConfig
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
      return handleSedePhase(phoneNumber, userMessage, clientId, state, searchOptionsConfig)

    case 'awaiting_search_type':
      return handleSearchTypePhase(phoneNumber, userMessage, clientId, state, escalationPhoneNumber, searchOptionsConfig)

    case 'awaiting_professional_name':
      return handleProfessionalNamePhase(phoneNumber, userMessage, clientId, state, escalationPhoneNumber)

    case 'awaiting_professional_selection':
      return handleProfessionalSelectionPhase(phoneNumber, userMessage, clientId, state, escalationPhoneNumber)

    case 'awaiting_specialty_selection':
      return handleSpecialtyPhase(phoneNumber, userMessage, clientId, state, escalationPhoneNumber)

    case 'awaiting_turno_selection':
      return handleTurnoPhase(phoneNumber, userMessage, clientId, state, escalationPhoneNumber)

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
  state: ExistingPatientFlowState,
  searchOptionsConfig?: SearchOptionsConfig
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
      message: buildSearchOptionsMessage(state.sedeNombre, searchOptionsConfig),
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
  state: ExistingPatientFlowState,
  escalationPhoneNumber?: string,
  searchOptionsConfig?: SearchOptionsConfig
): Promise<ExistingPatientResult> {
  const logger = createConversationLogger(phoneNumber, clientId, 'search_type_phase')

  logger.info('[SEARCH_TYPE] Procesando respuesta del usuario', {
    userMessage,
    currentPhase: state.phase,
    sedeNombre: state.sedeNombre,
    previousProfesional: state.profesionalNombre,
    previousEspecialidad: state.especialidadNombre,
  })

  const result = await handleSearchTypeSelection(userMessage, phoneNumber, clientId, searchOptionsConfig)

  logger.info('[SEARCH_TYPE] Resultado de seleccion', {
    searchType: result.searchType,
    message: result.message?.substring(0, 50),
  })

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
      logger.info('[SEARCH_TYPE] Opcion "cualquier_medico" seleccionada - buscando turnos sin filtro de profesional', {
        sedeId: state.sedeId,
        sedeNombre: state.sedeNombre,
      })
      return await searchAndShowTurnos(phoneNumber, clientId, state, escalationPhoneNumber)
    }
  }

  // Input no reconocido
  logger.info('[SEARCH_TYPE] Input no reconocido', {
    userMessage,
    resultMessage: result.message?.substring(0, 50),
  })
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
  state: ExistingPatientFlowState,
  escalationPhoneNumber?: string
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

      return await searchAndShowTurnos(phoneNumber, clientId, state, escalationPhoneNumber)
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
  state: ExistingPatientFlowState,
  escalationPhoneNumber?: string
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

    return await searchAndShowTurnos(phoneNumber, clientId, state, escalationPhoneNumber)
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
  state: ExistingPatientFlowState,
  escalationPhoneNumber?: string
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

    return await searchAndShowTurnos(phoneNumber, clientId, state, escalationPhoneNumber)
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
  state: ExistingPatientFlowState,
  escalationPhoneNumber?: string
): Promise<ExistingPatientResult> {
  const logger = createConversationLogger(phoneNumber, clientId, 'turnos_search')

  logger.info('[TURNOS] Iniciando busqueda de turnos', {
    sedeId: state.sedeId,
    sedeNombre: state.sedeNombre,
    profesionalId: state.profesionalId,
    profesionalNombre: state.profesionalNombre,
    especialidadId: state.especialidadId,
    especialidadNombre: state.especialidadNombre,
    searchType: state.searchType,
    patientDNI: state.patientDNI,
    obraSocialId: state.obraSocialId,
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

  logger.info('[TURNOS] Resultado de busqueda', {
    success: result.success,
    turnosCount: result.turnos?.length || 0,
    rangoUtilizado: result.rangoUtilizado,
    error: result.error,
  })

  if (!result.success || !result.turnos || result.turnos.length === 0) {
    // Guardar nombres para el mensaje ANTES de limpiar
    const mensajeProfesional = state.profesionalNombre
    const mensajeEspecialidad = state.especialidadNombre
    
    logger.info('[TURNOS] No se encontraron turnos - mostrando opciones alternativas', {
      sedeNombre: state.sedeNombre,
      profesionalNombre: mensajeProfesional,
      especialidadNombre: mensajeEspecialidad,
      previousPhase: state.phase,
      newPhase: 'awaiting_search_type',
      searchType: state.searchType,
      infoSinTurnos: result.infoSinTurnos ? 'present' : 'absent',
    })
    
    // Limpiar datos del profesional/especialidad anterior para nueva busqueda
    state.profesionalId = undefined
    state.profesionalNombre = undefined
    state.especialidadId = undefined
    state.especialidadNombre = undefined
    state.profesionalesOpciones = undefined
    state.especialidadesOpciones = undefined
    state.turnosOpciones = undefined
    state.phase = 'awaiting_search_type'
    await saveFlowState(phoneNumber, state)
    
    const noTurnosMessage = buildNoTurnosMessage(
      state.sedeNombre,
      mensajeProfesional,
      mensajeEspecialidad,
      state.searchType,
      result.infoSinTurnos,
      escalationPhoneNumber
    )
    logger.info('[TURNOS] Mensaje enviado al usuario', {
      messagePreview: noTurnosMessage.substring(0, 100) + '...',
    })
    
    return {
      handled: true,
      message: noTurnosMessage,
      nextPhase: 'awaiting_search_type', // Volver a opciones de busqueda
    }
  }

  state.turnosOpciones = result.turnos
  state.phase = 'awaiting_turno_selection'
  await saveFlowState(phoneNumber, state)

  logger.info('Turnos found', { count: result.turnos.length, rango: result.rangoUtilizado })

  return {
    handled: true,
    message: buildTurnosListMessage(result.turnos, state.patientName, state.sedeNombre, state.profesionalNombre, result.rangoUtilizado),
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
  state: ExistingPatientFlowState,
  escalationPhoneNumber?: string
): Promise<ExistingPatientResult> {
  if (!state.turnosOpciones) {
    return { handled: false, shouldCallOpenAI: true }
  }

  const result = await handleTurnoSelection(userMessage, state.turnosOpciones, phoneNumber, clientId, state.searchType)

  // Si solicito rebusqueda con cualquier medico
  if (result.requestedRebusqueda) {
    state.searchType = 'cualquier_medico'
    state.profesionalId = undefined
    state.profesionalNombre = undefined
    state.especialidadId = undefined
    state.especialidadNombre = undefined
    state.turnosOpciones = undefined
    await saveFlowState(phoneNumber, state)
    
    // Iniciar busqueda con cualquier medico
    return await searchAndShowTurnos(phoneNumber, clientId, state, escalationPhoneNumber)
  }

  if (result.selectedTurno) {
    state.turnoSeleccionado = result.selectedTurno
    state.attempts = 0

    // Enriquecer estado con datos frescos de la API si faltan campos clave
    if (!state.patientFirstName || !state.patientLastName || !state.obraSocialNombre || !state.patientDNI) {
      const logger = createConversationLogger(phoneNumber, clientId, 'turno_phase_enrichment')
      await enrichPatientDataFromAPI(state, phoneNumber, clientId, logger)
    }

    state.phase = 'awaiting_confirmation'
    await saveFlowState(phoneNumber, state)

    return {
      handled: true,
      message: buildConfirmationMessage(
        result.selectedTurno,
        state.patientName,
        state.sedeNombre,
        state.obraSocialNombre,
        {
          apellido: state.patientLastName,
          nombre: state.patientFirstName,
          dni: state.patientDNI,
          telefono: state.patientPhone,
          email: state.patientEmail,
        }
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
    state.attempts = 0

    // Enriquecer estado con datos frescos de la API si faltan campos clave
    if (!state.patientFirstName || !state.patientLastName || !state.obraSocialNombre || !state.patientDNI) {
      const logger = createConversationLogger(phoneNumber, clientId, 'email_phase_enrichment')
      await enrichPatientDataFromAPI(state, phoneNumber, clientId, logger)
    }

    state.phase = 'awaiting_confirmation'
    await saveFlowState(phoneNumber, state)

    return {
      handled: true,
      message: buildConfirmationMessage(
        state.turnoSeleccionado!,
        state.patientName,
        state.sedeNombre,
        state.obraSocialNombre,
        {
          apellido: state.patientLastName,
          nombre: state.patientFirstName,
          dni: state.patientDNI,
          telefono: state.patientPhone,
          email: state.patientEmail,
        }
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

    // Fallback final: si aún falta el DNI o datos del paciente, obtener datos frescos de la API usando el teléfono
    if (!dniParaReserva || !nombreParaReserva || !apellidoParaReserva) {
      logger.info('Patient data missing, fetching fresh patient data from API', { 
        phone: phoneNumber,
        dniMissing: !dniParaReserva,
        nombreMissing: !nombreParaReserva,
        apellidoMissing: !apellidoParaReserva
      })
      try {
        const clinicAPI = new ClinicAPI(clientId)
        const pacienteResponse = await clinicAPI.paciente_telefono(phoneNumber)
        
        if (pacienteResponse.exito && pacienteResponse.datos) {
          let paciente: Record<string, unknown> | null = null
          
          // Manejar caso de pacientes_multiples: filtrar SOLO por DNI
          if (pacienteResponse.datos.warning === 'pacientes_multiples' && Array.isArray(pacienteResponse.datos.pacientes)) {
            const pacientes = pacienteResponse.datos.pacientes
            logger.info('Multiple patients found, filtering by DNI only', { 
              totalPacientes: pacientes.length,
              stateDNI: state.patientDNI
            })
            
            // Filtrar SOLO por DNI - no usar email ni fallback
            if (state.patientDNI) {
              const foundByDNI = pacientes.find((p: Record<string, unknown>) => 
                String(p.Nrodoc || p.nrodoc || p.dni || '').trim() === state.patientDNI.trim()
              )
              if (foundByDNI) {
                paciente = foundByDNI as Record<string, unknown>
                logger.info('Found patient by DNI', { dni: state.patientDNI })
              } else {
                logger.warn('Could not find patient by DNI in multiple patients list', { dni: state.patientDNI })
              }
            } else {
              logger.warn('Cannot filter multiple patients without DNI in state')
            }
          } else {
            // Caso normal: un solo paciente
            paciente = (pacienteResponse.datos.paciente || pacienteResponse.datos) as Record<string, unknown>
          }
          
          if (paciente) {
            if (!dniParaReserva) dniParaReserva = String(paciente.Nrodoc || paciente.dni || '').trim()
            if (!nombreParaReserva) nombreParaReserva = String(paciente.Nombres || paciente.nombres || '').trim()
            if (!apellidoParaReserva) apellidoParaReserva = String(paciente.Apellido || paciente.apellido || '').trim()
            // Actualizar obra social en el estado si falta
            if (!state.obraSocialId) state.obraSocialId = String(paciente.Deudor_Id || paciente.deudor_id || '')
            if (!state.obraSocialNombre) state.obraSocialNombre = String(paciente.Deudor_Nombre || paciente.deudor_nombre || '')
            
            logger.info('Retrieved patient data from API for reservation', {
              firstName: nombreParaReserva,
              lastName: apellidoParaReserva,
              dni: dniParaReserva,
              obraSocialId: state.obraSocialId,
              obraSocialNombre: state.obraSocialNombre,
            })
          } else {
            logger.warn('Could not find matching patient in API response')
          }
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
