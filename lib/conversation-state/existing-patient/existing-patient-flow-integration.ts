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
import { extractEntities } from '../entity-extractor'
import { getHistory } from '../conversation-history'

// Importar handlers compartidos
import {
  fetchSedes,
  buildSedesMessage,
  handleSedeSelection as handleSedeSelectionShared,
  buildSedesErrorMessage,
  type SedeInterruptionOptions,
} from '../shared/sede-handler'
import {
  buildSearchOptionsMessage,
  buildSearchOptionsButtons,
  handleSearchTypeSelection,
  buildProfessionalNameRequestMessage,
  type SearchOptionsConfig,
} from '../shared/search-options-handler'
import {
  fetchSpecialties,
  buildSpecialtiesMessage,
  handleSpecialtySelection,
  buildSpecialtiesErrorMessage,
  type SpecialtyInterruptionOptions,
} from '../shared/specialty-handler'
import {
  searchProfessionals,
  buildProfessionalsListMessage,
  handleProfessionalSelection,
  handleProfessionalNameInput,
  type ProfessionalInterruptionOptions,
} from '../shared/professional-handler'
import {
  searchTurnosFull,
  getNextWindow,
  buildTurnosWindowMessage,
  buildTurnosFilteredMessage,
  buildNoTurnosMessage,
  buildTurnosListMessage,
} from '../shared/turnos-handler'
import {
  handleTurnoSelection,
  buildTurnoSelectedMessage,
  buildInvalidSelectionMessage,
  type TurnoInterruptionOptions,
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
  buildModifyDataMenu,
  detectModifyDataOption,
} from '../shared/confirmation-handler'
import type {
  SedeOption,
  SpecialtyOption,
  ProfessionalOption,
  TurnoOption,
  FlowPhase,
} from '../shared/types'
import {
  isBackCommand,
  withBackOption,
  getPreviousPhase,
  MAIN_MENU,
} from '../shared/back-navigation'

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
  searchType?: 'medico_particular' | 'especialidad' | 'cualquier_medico' | 'cambiar_sede'

  // Profesional
  profesionalId?: string
  profesionalNombre?: string
  profesionalesOpciones?: ProfessionalOption[]

  // Especialidad
  especialidadId?: string
  especialidadNombre?: string
  especialidadesOpciones?: SpecialtyOption[]

  // Turnos
  /** Array completo de 60 días con numeración 1..N permanente */
  turnosOpciones?: TurnoOption[]
  /** Turnos mostrados al paciente hasta ahora (paginación) */
  turnosMostrados: number
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
  /** Rows for WhatsApp List Message — present when the message is a sede selection prompt */
  sedesListRows?: Array<{ id: string; title: string; description?: string }>
  /** Buttons for WhatsApp Reply Buttons — present when the message is a search type prompt */
  searchTypeButtons?: Array<{ id: string; title: string }>
  /** Buttons for turnos pagination: "Ver más" (when hasMore) + "Volver a paso ant." */
  turnosButtons?: Array<{ id: string; title: string }>
  /** True when message is a confirmation prompt — triggers 3 Reply Buttons */
  confirmationButtons?: boolean
  /** True when message is a professional name prompt — triggers "Volver a paso ant." button */
  atrasButton?: boolean
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
  escalationPhoneNumber?: string,
  initialMessage?: string
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
          
          const firstName = getFirstName(finalPatientFirstName || '')
          const saludo = firstName ? `Hola ${firstName}. ` : ''
          return {
            handled: true,
            message: `${saludo}Lamentablemente, tu obra social (${finalObraSocialNombre}) no está habilitada para agendar turnos por este medio.

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

  // --- Entity extraction del mensaje inicial ---
  let profesionalMencionado: string | null = null
  let cualquierSede = false

  if (initialMessage && flags.entityExtraction) {
    try {
      const history = flags.conversationHistory ? await getHistory(phoneNumber) : []
      const extraction = await extractEntities(initialMessage, history, true)
      if (extraction.hasData) {
        logger.info('Entity extraction on existing patient init', { entities: extraction.entities })
        profesionalMencionado = extraction.entities.profesional
      }
    } catch (err) {
      logger.error('Entity extraction failed during existing patient init', err as Error)
    }
    // Detectar "cualquier sede" con regex (no necesita GPT)
    cualquierSede = /cualquier\s*(sede|lugar|sucursal|consultorio)?|indistint|no.*importa.*sede|todas\s*las\s*sedes/i.test(initialMessage)
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

  const primerNombre = getFirstName(patientName)
  const welcomeMessage = `Hola ${primerNombre}, te ayudo a agendar un nuevo turno.`

  // Determinar sede: auto-seleccionar si hay solo una o si el paciente dijo "cualquier sede"
  const autoSelectSede = sedesResult.sedes.length === 1 || cualquierSede
  const sedeFastPath = autoSelectSede ? sedesResult.sedes[0] : null

  // --- FAST PATH: profesional + (cualquier sede o sede única) ---
  // Salta sede, search_type y professional_name, va directo a la búsqueda
  if (sedeFastPath && profesionalMencionado) {
    logger.info('Fast path: auto-selecting sede + searching professional', {
      sede: sedeFastPath.nombre,
      profesional: profesionalMencionado,
      cualquierSede,
    })

    const state: ExistingPatientFlowState = {
      phase: 'awaiting_professional_name',
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
      sedeId: sedeFastPath.id,
      sedeNombre: sedeFastPath.nombre,
      searchType: 'medico_particular',
      attempts: 0,
      turnosMostrados: 0,
      createdAt: Date.now(),
      lastUpdated: Date.now(),
    }
    await saveFlowState(phoneNumber, state)

    // Auto-submit el nombre del profesional
    const profResult = await handleProfessionalNameInput(profesionalMencionado, clientId, phoneNumber)

    if (profResult.profesionales && profResult.profesionales.length > 0) {
      state.profesionalesOpciones = profResult.profesionales

      if (profResult.profesionales.length === 1) {
        // Único resultado → ir directo a turnos
        state.profesionalId = profResult.profesionales[0].id
        state.profesionalNombre = profResult.profesionales[0].nombre
        await saveFlowState(phoneNumber, state)
        const turnosResult = await searchAndShowTurnos(phoneNumber, clientId, state, escalationPhoneNumber)
        if (turnosResult.handled && turnosResult.message) {
          return {
            handled: true,
            message: `${welcomeMessage}\n\n${turnosResult.message}`,
            nextPhase: turnosResult.nextPhase,
          }
        }
        return turnosResult
      }

      // Múltiples profesionales → mostrar lista para selección
      state.phase = 'awaiting_professional_selection'
      await saveFlowState(phoneNumber, state)
      return {
        handled: true,
        message: `${welcomeMessage}\n\n${profResult.message}`,
        nextPhase: 'awaiting_professional_selection',
      }
    }

    // No se encontró el profesional → pedir nombre manualmente
    state.phase = 'awaiting_professional_name'
    await saveFlowState(phoneNumber, state)
    return {
      handled: true,
      message: `${welcomeMessage}\n\nNo encontré ningún profesional con el nombre "${profesionalMencionado}". ¿Podés escribir el apellido nuevamente?`,
      nextPhase: 'awaiting_professional_name',
    }
  }

  // --- AUTO-SELECT sede (única o "cualquier") sin profesional conocido ---
  if (sedeFastPath) {
    logger.info('Auto-selecting sede', { sede: sedeFastPath.nombre, cualquierSede })

    const state: ExistingPatientFlowState = {
      phase: 'awaiting_search_type',
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
      sedeId: sedeFastPath.id,
      sedeNombre: sedeFastPath.nombre,
      turnosMostrados: 0,
      attempts: 0,
      createdAt: Date.now(),
      lastUpdated: Date.now(),
    }
    await saveFlowState(phoneNumber, state)

    return {
      handled: true,
      message: `${welcomeMessage}\n\n${buildSearchOptionsMessage(sedeFastPath.nombre, undefined)}`,
      nextPhase: 'awaiting_search_type',
      searchTypeButtons: buildSearchOptionsButtons(undefined),
    }
  }

  // --- Flujo normal: múltiples sedes, sin fast-path ---
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
    turnosMostrados: 0,
    attempts: 0,
    createdAt: Date.now(),
    lastUpdated: Date.now(),
  }

  // Si mencionó un profesional pero no eligió sede, guardar hint en estado
  if (profesionalMencionado) {
    ;(state as any)._profesionalMencionado = profesionalMencionado
  }

  await saveFlowState(phoneNumber, state)

  logger.info('Flow initialized', { sedesCount: sedesResult.sedes.length, profesionalMencionado })

  const sedesListRows = sedesResult.sedes.map(s => ({
    id: String(s.numero),
    title: s.nombre.substring(0, 24),
    description: [s.domicilio, s.localidad].filter(Boolean).join(', ').substring(0, 72),
  }))

  return {
    handled: true,
    message: `${welcomeMessage}\n\n${buildSedesMessage(sedesResult.sedes)}`,
    nextPhase: 'awaiting_sede',
    sedesListRows,
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

  // Leer flag de interrupción una sola vez para todo el router
  const flags = await getEffectiveFeatureFlags(clientId)
  const flowInterruptionEnabled = flags.flowInterruptionHandler === true

  // Pre-check de "Volver al paso anterior" (opción 0 o palabras clave)
  if (isBackCommand(userMessage)) {
    logger.info('[BACK] Comando de volver detectado', { phase: state.phase })
    return handleBackNavigation(phoneNumber, clientId, state, searchOptionsConfig, escalationPhoneNumber)
  }

  // Router por fase
  let result: ExistingPatientResult
  switch (state.phase) {
    case 'awaiting_sede':
      result = await handleSedePhase(phoneNumber, userMessage, clientId, state, searchOptionsConfig, flowInterruptionEnabled, escalationPhoneNumber)
      break

    case 'awaiting_search_type':
      result = await handleSearchTypePhase(phoneNumber, userMessage, clientId, state, escalationPhoneNumber, searchOptionsConfig)
      break

    case 'awaiting_professional_name':
      result = await handleProfessionalNamePhase(phoneNumber, userMessage, clientId, state, escalationPhoneNumber)
      break

    case 'awaiting_professional_selection':
      result = await handleProfessionalSelectionPhase(phoneNumber, userMessage, clientId, state, escalationPhoneNumber, flowInterruptionEnabled)
      break

    case 'awaiting_specialty_selection':
      result = await handleSpecialtyPhase(phoneNumber, userMessage, clientId, state, escalationPhoneNumber, flowInterruptionEnabled)
      break

    case 'awaiting_turno_selection':
      result = await handleTurnoPhase(phoneNumber, userMessage, clientId, state, escalationPhoneNumber, flowInterruptionEnabled)
      break

    case 'awaiting_email':
      result = await handleEmailPhase(phoneNumber, userMessage, clientId, state)
      break

    case 'awaiting_confirmation':
      result = await handleConfirmationPhase(phoneNumber, userMessage, clientId, state)
      break

    case 'awaiting_modify_selection':
      result = await handleModifySelectionPhase(phoneNumber, userMessage, clientId, state, escalationPhoneNumber, searchOptionsConfig)
      break

    case 'awaiting_modify_nombre':
      result = await handleModifyNombrePhase(phoneNumber, userMessage, clientId, state)
      break

    case 'awaiting_modify_dni':
      result = await handleModifyDniPhase(phoneNumber, userMessage, clientId, state)
      break

    case 'awaiting_modify_obra_social':
      result = await handleModifyObraSocialPhase(phoneNumber, userMessage, clientId, state)
      break

    default:
      logger.warn('Unhandled phase', { phase: state.phase })
      return { handled: false, shouldCallOpenAI: true }
  }

  // Anexar centralmente la opción "Volver al paso anterior" al mensaje saliente
  if (result.handled && result.message && !result.shouldCallOpenAI) {
    result.message = withBackOption(result.message, result.nextPhase, 'existing')
  }
  return result
}

/**
 * Maneja el comando "Volver al paso anterior" para el flujo de paciente existente.
 * Limpia los datos del paso actual, retrocede a la fase previa y re-renderiza su mensaje.
 * Si no hay paso previo (primer paso), devuelve action 'back_to_main_menu'.
 */
async function handleBackNavigation(
  phoneNumber: string,
  clientId: string,
  state: ExistingPatientFlowState,
  searchOptionsConfig?: SearchOptionsConfig,
  escalationPhoneNumber?: string
): Promise<ExistingPatientResult> {
  const logger = createConversationLogger(phoneNumber, clientId, 'back_navigation')
  const prev = getPreviousPhase(state.phase, { flow: 'existing', searchType: state.searchType })

  // Primer paso -> volver al menú principal de detección
  if (prev === MAIN_MENU) {
    logger.info('[BACK] Sin paso previo, volviendo al menú principal', { phase: state.phase })
    await clearExistingPatientFlow(phoneNumber)
    return { handled: true, action: 'back_to_main_menu' }
  }

  logger.info('[BACK] Retrocediendo de fase', { from: state.phase, to: prev })
  state.attempts = 0

  switch (prev) {
    case 'awaiting_sede': {
      // Limpiar sede y todo lo posterior
      state.sedeId = undefined
      state.sedeNombre = undefined
      state.searchType = undefined
      state.profesionalId = undefined
      state.profesionalNombre = undefined
      state.profesionalesOpciones = undefined
      state.especialidadId = undefined
      state.especialidadNombre = undefined
      state.especialidadesOpciones = undefined
      state.turnosOpciones = undefined
      state.turnoSeleccionado = undefined
      state.phase = 'awaiting_sede'

      if (!state.sedesOpciones || state.sedesOpciones.length === 0) {
        const sedesResult = await fetchSedes(clientId)
        if (!sedesResult.success || !sedesResult.sedes) {
          return { handled: true, message: buildSedesErrorMessage(), nextPhase: 'error' }
        }
        state.sedesOpciones = sedesResult.sedes
      }
      await saveFlowState(phoneNumber, state)
      return {
        handled: true,
        message: withBackOption(buildSedesMessage(state.sedesOpciones), 'awaiting_sede', 'existing'),
        nextPhase: 'awaiting_sede',
      }
    }

    case 'awaiting_search_type': {
      state.searchType = undefined
      state.profesionalId = undefined
      state.profesionalNombre = undefined
      state.profesionalesOpciones = undefined
      state.especialidadId = undefined
      state.especialidadNombre = undefined
      state.especialidadesOpciones = undefined
      state.turnosOpciones = undefined
      state.turnoSeleccionado = undefined
      state.phase = 'awaiting_search_type'
      await saveFlowState(phoneNumber, state)
      return {
        handled: true,
        message: withBackOption(buildSearchOptionsMessage(state.sedeNombre || '', searchOptionsConfig), 'awaiting_search_type', 'existing'),
        nextPhase: 'awaiting_search_type',
        searchTypeButtons: buildSearchOptionsButtons(searchOptionsConfig),
      }
    }

    case 'awaiting_professional_name': {
      state.profesionalId = undefined
      state.profesionalNombre = undefined
      state.profesionalesOpciones = undefined
      state.turnosOpciones = undefined
      state.turnoSeleccionado = undefined
      state.phase = 'awaiting_professional_name'
      await saveFlowState(phoneNumber, state)
      return {
        handled: true,
        message: withBackOption(buildProfessionalNameRequestMessage(), 'awaiting_professional_name', 'existing'),
        nextPhase: 'awaiting_professional_name',
        atrasButton: true,
      }
    }

    case 'awaiting_specialty_selection': {
      state.especialidadId = undefined
      state.especialidadNombre = undefined
      state.turnosOpciones = undefined
      state.turnoSeleccionado = undefined
      state.phase = 'awaiting_specialty_selection'
      if (!state.especialidadesOpciones || state.especialidadesOpciones.length === 0) {
        const espResult = await fetchSpecialties(clientId)
        if (!espResult.success || !espResult.especialidades) {
          return { handled: true, message: buildSpecialtiesErrorMessage(), nextPhase: 'error' }
        }
        state.especialidadesOpciones = espResult.especialidades
      }
      await saveFlowState(phoneNumber, state)
      return {
        handled: true,
        message: withBackOption(buildSpecialtiesMessage(state.especialidadesOpciones), 'awaiting_specialty_selection', 'existing'),
        nextPhase: 'awaiting_specialty_selection',
      }
    }

    case 'awaiting_turno_selection': {
      // Volver a la lista de turnos: limpiar la selección y re-mostrar/re-buscar
      state.turnoSeleccionado = undefined
      state.phase = 'awaiting_turno_selection'
      if (state.turnosOpciones && state.turnosOpciones.length > 0) {
        await saveFlowState(phoneNumber, state)
        return {
          handled: true,
          message: withBackOption(
            buildTurnosListMessage(state.turnosOpciones, state.patientName, state.sedeNombre, state.profesionalNombre),
            'awaiting_turno_selection',
            'existing'
          ),
          nextPhase: 'awaiting_turno_selection',
        }
      }
      await saveFlowState(phoneNumber, state)
      const turnosResult = await searchAndShowTurnos(phoneNumber, clientId, state, escalationPhoneNumber)
      if (turnosResult.message) {
        turnosResult.message = withBackOption(turnosResult.message, turnosResult.nextPhase, 'existing')
      }
      return turnosResult
    }

    case 'awaiting_confirmation': {
      // Volver desde un paso de modificación hacia la confirmación
      state.phase = 'awaiting_confirmation'
      await saveFlowState(phoneNumber, state)
      return {
        handled: true,
        message: withBackOption(
          buildConfirmationMessage(
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
          'awaiting_confirmation',
          'existing'
        ),
        nextPhase: 'awaiting_confirmation',
        confirmationButtons: true,
      }
    }

    default: {
      // Caso no esperado: volver al menú principal por seguridad
      logger.warn('[BACK] Paso previo no manejado, volviendo al menú principal', { prev })
      await clearExistingPatientFlow(phoneNumber)
      return { handled: true, action: 'back_to_main_menu' }
    }
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
  searchOptionsConfig?: SearchOptionsConfig,
  flowInterruptionEnabled?: boolean,
  escalationPhoneNumber?: string
): Promise<ExistingPatientResult> {
  const logger = createConversationLogger(phoneNumber, clientId, 'sede_phase')

  if (!state.sedesOpciones || state.sedesOpciones.length === 0) {
    return { handled: false, shouldCallOpenAI: true }
  }

  const interruptionOptions: SedeInterruptionOptions | undefined = flowInterruptionEnabled
    ? {
        originalSedesMessage: buildSedesMessage(state.sedesOpciones),
        escalationPhone: escalationPhoneNumber,
      }
    : undefined

  const result = await handleSedeSelectionShared(userMessage, state.sedesOpciones, phoneNumber, clientId, interruptionOptions)

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
      searchTypeButtons: buildSearchOptionsButtons(searchOptionsConfig),
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
        atrasButton: true,
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

    if (result.searchType === 'cambiar_sede') {
      // Opcion "Buscar en otra sede": volver al paso de seleccion de sede.
      logger.info('[SEARCH_TYPE] Opcion "cambiar_sede" seleccionada - volviendo a seleccion de sede', {
        previousSedeId: state.sedeId,
        previousSedeNombre: state.sedeNombre,
      })

      // Limpiar la sede y los filtros previos para empezar la busqueda en otra sede
      state.sedeId = undefined
      state.sedeNombre = undefined
      state.profesionalId = undefined
      state.profesionalNombre = undefined
      state.especialidadId = undefined
      state.especialidadNombre = undefined
      state.profesionalesOpciones = undefined
      state.especialidadesOpciones = undefined
      state.turnosOpciones = undefined
      state.searchType = undefined
      state.phase = 'awaiting_sede'
      await saveFlowState(phoneNumber, state)

      // Reutilizar las sedes ya cargadas; si no estuvieran, dejar que OpenAI maneje
      if (!state.sedesOpciones || state.sedesOpciones.length === 0) {
        return { handled: false, shouldCallOpenAI: true }
      }

      return {
        handled: true,
        message: buildSedesMessage(state.sedesOpciones),
        nextPhase: 'awaiting_sede',
      }
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
  escalationPhoneNumber?: string,
  flowInterruptionEnabled?: boolean
): Promise<ExistingPatientResult> {
  if (!state.profesionalesOpciones) {
    return { handled: false, shouldCallOpenAI: true }
  }

  const interruptionOptions: ProfessionalInterruptionOptions | undefined = flowInterruptionEnabled && state.profesionalesOpciones.length > 0
    ? {
        originalProfessionalsMessage: buildProfessionalsListMessage(state.profesionalesOpciones, ''),
        escalationPhone: escalationPhoneNumber,
      }
    : undefined

  const result = await handleProfessionalSelection(userMessage, state.profesionalesOpciones, phoneNumber, clientId, interruptionOptions)

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
  escalationPhoneNumber?: string,
  flowInterruptionEnabled?: boolean
): Promise<ExistingPatientResult> {
  if (!state.especialidadesOpciones) {
    return { handled: false, shouldCallOpenAI: true }
  }

  const interruptionOptions: SpecialtyInterruptionOptions | undefined = flowInterruptionEnabled && state.especialidadesOpciones.length > 0
    ? {
        originalSpecialtiesMessage: buildSpecialtiesMessage(state.especialidadesOpciones),
        escalationPhone: escalationPhoneNumber,
      }
    : undefined

  const result = await handleSpecialtySelection(userMessage, state.especialidadesOpciones, phoneNumber, clientId, interruptionOptions)

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

  const result = await searchTurnosFull(
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
      escalationPhoneNumber,
      state.obraSocialNombre
    )
    logger.info('[TURNOS] Mensaje enviado al usuario', {
      messagePreview: noTurnosMessage.substring(0, 100) + '...',
    })

    return {
      handled: true,
      message: noTurnosMessage,
      nextPhase: 'awaiting_search_type',
    }
  }

  // Guardar todos los turnos con numeración permanente
  state.turnosOpciones = result.turnos
  state.turnosMostrados = 0
  state.phase = 'awaiting_turno_selection'
  await saveFlowState(phoneNumber, state)

  // Mostrar primera ventana de 15 días
  const window = getNextWindow(result.turnos, 0)
  state.turnosMostrados = window.newShownCount
  await saveFlowState(phoneNumber, state)

  logger.info('Turnos found', { total: result.turnos.length, firstWindow: window.turnos.length })

  return {
    handled: true,
    message: buildTurnosWindowMessage(
      window.turnos,
      result.turnos.length,
      window.hasMore,
      state.patientName,
      state.sedeNombre,
      state.profesionalNombre,
      true
    ),
    nextPhase: 'awaiting_turno_selection',
    turnosButtons: window.hasMore
      ? [{ id: "ver_mas", title: "Ver más" }, { id: "0", title: "Volver a paso ant." }]
      : [{ id: "0", title: "Volver a paso ant." }],
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
  escalationPhoneNumber?: string,
  flowInterruptionEnabled?: boolean
): Promise<ExistingPatientResult> {
  if (!state.turnosOpciones) {
    return { handled: false, shouldCallOpenAI: true }
  }

  const interruptionOptions: TurnoInterruptionOptions | undefined = flowInterruptionEnabled && state.turnosOpciones.length > 0
    ? {
        originalTurnosMessage: buildInvalidSelectionMessage(state.turnosOpciones, state.searchType),
        escalationPhone: escalationPhoneNumber,
      }
    : undefined

  const result = await handleTurnoSelection(userMessage, state.turnosOpciones, phoneNumber, clientId, state.searchType, interruptionOptions, state.profesionalNombre)

  // Paginación: ver más (siguiente ventana de 15 días)
  if (result.showMore) {
    const nextWindow = getNextWindow(state.turnosOpciones, state.turnosMostrados ?? 0)
    if (nextWindow.turnos.length === 0) {
      return {
        handled: true,
        message: `_Esos son todos los turnos disponibles en los próximos 60 días._`,
        nextPhase: 'awaiting_turno_selection',
      }
    }
    state.turnosMostrados = nextWindow.newShownCount
    await saveFlowState(phoneNumber, state)
    return {
      handled: true,
      message: buildTurnosWindowMessage(
        nextWindow.turnos,
        state.turnosOpciones.length,
        nextWindow.hasMore,
        state.patientName,
        state.sedeNombre,
        state.profesionalNombre,
        false
      ),
      nextPhase: 'awaiting_turno_selection',
      turnosButtons: nextWindow.hasMore
        ? [{ id: "ver_mas", title: "Ver más" }, { id: "0", title: "Volver a paso ant." }]
        : [{ id: "0", title: "Volver a paso ant." }],
    }
  }

  // Ver todos: volver a la primera ventana
  if (result.showAll) {
    const firstWindow = getNextWindow(state.turnosOpciones, 0)
    state.turnosMostrados = firstWindow.newShownCount
    await saveFlowState(phoneNumber, state)
    return {
      handled: true,
      message: buildTurnosWindowMessage(
        firstWindow.turnos,
        state.turnosOpciones.length,
        firstWindow.hasMore,
        state.patientName,
        state.sedeNombre,
        state.profesionalNombre,
        true
      ),
      nextPhase: 'awaiting_turno_selection',
    }
  }

  // Filtro por texto libre (en memoria, sin nueva API call)
  if (result.filteredTurnos && result.filteredMessage) {
    return {
      handled: true,
      message: result.filteredMessage,
      nextPhase: 'awaiting_turno_selection',
    }
  }

  // Si solicito rebusqueda con cualquier medico
  if (result.requestedRebusqueda) {
    state.searchType = 'cualquier_medico'
    state.profesionalId = undefined
    state.profesionalNombre = undefined
    state.especialidadId = undefined
    state.especialidadNombre = undefined
    state.turnosOpciones = undefined
    state.turnosMostrados = 0
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
      confirmationButtons: true,
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
      confirmationButtons: true,
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

  if (result.confirmed === false && result.nextPhase === 'awaiting_modify_selection') {
    state.phase = 'awaiting_modify_selection'
    await saveFlowState(phoneNumber, state)
    return {
      handled: true,
      message: result.message,
      nextPhase: 'awaiting_modify_selection',
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
    confirmationButtons: true,
  }
}

/**
 * Fase: Modificar Nombre y Apellido
 */
async function handleModifyNombrePhase(
  phoneNumber: string,
  userMessage: string,
  clientId: string,
  state: ExistingPatientFlowState
): Promise<ExistingPatientResult> {
  const logger = createConversationLogger(phoneNumber, clientId, 'modify_nombre_phase')

  const input = userMessage.trim()
  const parts = input.split(/\s+/)

  if (parts.length < 2) {
    return {
      handled: true,
      message: `Necesito tu nombre y apellido completo. Por ejemplo: *Juan Perez*`,
    }
  }

  const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
  const nuevoNombre = capitalize(parts[0])
  const nuevoApellido = parts.slice(1).map(capitalize).join(' ')

  state.patientFirstName = nuevoNombre
  state.patientLastName = nuevoApellido
  state.patientName = `${nuevoNombre} ${nuevoApellido}`
  state.phase = 'awaiting_confirmation'
  await saveFlowState(phoneNumber, state)

  logger.info('Nombre updated', { nombre: nuevoNombre, apellido: nuevoApellido })

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
    confirmationButtons: true,
  }
}

/**
 * Fase: Modificar DNI
 */
async function handleModifyDniPhase(
  phoneNumber: string,
  userMessage: string,
  clientId: string,
  state: ExistingPatientFlowState
): Promise<ExistingPatientResult> {
  const logger = createConversationLogger(phoneNumber, clientId, 'modify_dni_phase')

  const input = userMessage.trim().replace(/[.\s-]/g, '')

  if (!/^\d{7,9}$/.test(input)) {
    return {
      handled: true,
      message: `El DNI ingresado no es valido. Por favor, escribi solo numeros (sin puntos ni espacios).`,
    }
  }

  state.patientDNI = input
  state.phase = 'awaiting_confirmation'
  await saveFlowState(phoneNumber, state)

  logger.info('DNI updated', { dni: input })

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
    confirmationButtons: true,
  }
}

/**
 * Fase: Modificar Obra Social
 */
async function handleModifyObraSocialPhase(
  phoneNumber: string,
  userMessage: string,
  clientId: string,
  state: ExistingPatientFlowState
): Promise<ExistingPatientResult> {
  const logger = createConversationLogger(phoneNumber, clientId, 'modify_obra_social_phase')

  const input = userMessage.trim()

  try {
    const result = await validarObraSocial(clientId, input)

    if (!result.exito || !result.datos || result.datos.total_encontradas === 0) {
      return {
        handled: true,
        message: `No encontre "${input}" en nuestro sistema. Por favor, verifica el nombre de tu obra social e intenta nuevamente.\n\nSi no tenes cobertura, escribi *Particular*.`,
      }
    }

    const obraSocial = result.datos.obras_sociales[0]
    state.obraSocialId = obraSocial.id
    state.obraSocialNombre = obraSocial.nombre
    state.phase = 'awaiting_confirmation'
    await saveFlowState(phoneNumber, state)

    logger.info('Obra social updated', { obraSocialNombre: obraSocial.nombre })

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
      confirmationButtons: true,
    }
  } catch (error) {
    logger.error('Error validating obra social', error as Error)
    return {
      handled: true,
      message: `Ocurrio un error al validar tu obra social. Por favor, intenta nuevamente.`,
    }
  }
}

/**
 * Fase: Seleccion de dato a modificar
 */
async function handleModifySelectionPhase(
  phoneNumber: string,
  userMessage: string,
  clientId: string,
  state: ExistingPatientFlowState,
  escalationPhoneNumber?: string,
  searchOptionsConfig?: SearchOptionsConfig
): Promise<ExistingPatientResult> {
  const logger = createConversationLogger(phoneNumber, clientId, 'modify_selection_phase')

  const option = detectModifyDataOption(userMessage)

  if (!option) {
    return {
      handled: true,
      message: `No entendi tu respuesta. Por favor, responde con el numero de la opcion:\n\n${buildModifyDataMenu()}`,
      nextPhase: 'awaiting_modify_selection',
    }
  }

  logger.info('Modify option selected', { option })

  if (option === 'nombre') {
    // Solicitar nuevo nombre y apellido
    state.phase = 'awaiting_modify_nombre'
    await saveFlowState(phoneNumber, state)
    return {
      handled: true,
      message: `Por favor, escribi tu *nombre y apellido completo* corregido.`,
      nextPhase: 'awaiting_modify_nombre',
    }
  }

  if (option === 'dni') {
    // Solicitar nuevo DNI
    state.phase = 'awaiting_modify_dni'
    await saveFlowState(phoneNumber, state)
    return {
      handled: true,
      message: `Por favor, escribi tu *DNI* corregido (solo numeros, sin puntos ni espacios).`,
      nextPhase: 'awaiting_modify_dni',
    }
  }

  if (option === 'obra_social') {
    // Solicitar nueva obra social
    state.phase = 'awaiting_modify_obra_social'
    await saveFlowState(phoneNumber, state)
    return {
      handled: true,
      message: `Por favor, escribi el nombre de tu *obra social o prepaga*.\n\nSi no tenes cobertura, escribi *Particular*.`,
      nextPhase: 'awaiting_modify_obra_social',
    }
  }

  if (option === 'turno') {
    // Reiniciar desde seleccion de sede conservando datos del paciente
    const sedesResult = await fetchSedes(clientId)
    if (!sedesResult.success || !sedesResult.sedes) {
      return {
        handled: true,
        message: buildSedesErrorMessage(),
        nextPhase: 'error',
      }
    }

    state.sedesOpciones = sedesResult.sedes
    state.sedeId = undefined
    state.sedeNombre = undefined
    state.searchType = undefined
    state.profesionalId = undefined
    state.profesionalNombre = undefined
    state.profesionalesOpciones = undefined
    state.especialidadId = undefined
    state.especialidadNombre = undefined
    state.especialidadesOpciones = undefined
    state.turnosOpciones = undefined
    state.turnoSeleccionado = undefined
    state.phase = 'awaiting_sede'
    state.attempts = 0
    await saveFlowState(phoneNumber, state)

    logger.info('Restarting from sede for turno modification', {})

    return {
      handled: true,
      message: buildSedesMessage(sedesResult.sedes),
      nextPhase: 'awaiting_sede',
    }
  }

  return { handled: false }
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
