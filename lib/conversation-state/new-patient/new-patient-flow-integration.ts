/**
 * Integracion del flujo de paciente nuevo
 * Usa modulos compartidos para reutilizacion de codigo con paciente existente
 * 
 * FLUJO PACIENTE NUEVO segun documentacion:
 * 1. DNI (validado externamente antes de iniciar)
 * 2. Nombre y Apellido
 * 3. Obra Social (validacion via API)
 * 4. Sede (igual que paciente existente)
 * 5. Tipo de busqueda (igual que paciente existente)
 * 6. Busqueda profesional/especialidad (igual que paciente existente)
 * 7. Seleccion de turno (igual que paciente existente)
 * 8. Email (obligatorio para paciente nuevo)
 * 9. Confirmacion y reserva (igual que paciente existente)
 */

import { getRedisClient } from '@/lib/redis'
import { createConversationLogger } from '../logger'
import { getEffectiveFeatureFlags } from '../feature-flags'
import { validarObraSocial } from '@/lib/api-tools/api-functions'
import { extractSelection } from '../selection-extractor'
import { getFirstName } from '@/lib/utils/name-utils'
import { extractEntities } from '../entity-extractor'
import { getHistory, appendToHistory } from '../conversation-history'
import { generateWelcomeMessage, generateObraSocialRequest } from '../response-generator'

// Importar handlers compartidos
import {
  fetchSedes,
  buildSedesMessage,
  buildSedesListRows,
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
  handleProfessionalNameInput,
  handleProfessionalSelection,
  buildProfessionalsListMessage,
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
  buildEmailRequestMessage,
  handleEmailInput as handleEmailInputShared,
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
  ObraSocialValidada,
  ObraSocialOption,
} from '../shared/types'
import {
  isBackCommand,
  withBackOption,
  getPreviousPhase,
  MAIN_MENU,
} from '../shared/back-navigation'

// Constantes
const NEW_PATIENT_FLOW_KEY = 'new_patient_flow'
const NEW_PATIENT_FLOW_TTL = 86400 // 24 horas

// Estado del flujo de paciente nuevo
export interface NewPatientFlowState {
  phase: FlowPhase | 'awaiting_obra_social' | 'awaiting_obra_social_selection'
  dni: string
  phone: string
  
  // Datos personales (especificos de paciente nuevo)
  nombre?: string
  apellido?: string

  // Si el flujo fue iniciado para registrar a un familiar (no al usuario que escribe)
  esFamiliar?: boolean
  
  // Obra social
  obraSocialId?: string
  obraSocialNombre?: string
  obraSocialValidada: boolean
  obraSocialOpciones?: ObraSocialOption[]
  
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
  
  // Email (obligatorio para paciente nuevo)
  email?: string
  
  // Control
  attempts: number
  createdAt: number
  lastUpdated: number
  lastInvalidInput?: string
}

export interface NewPatientResult {
  handled: boolean
  message?: string
  action?: string
  patientInfo?: {
    dni: string
    name?: string
    email?: string
    healthInsurance?: string
  }
  shouldCallOpenAI?: boolean
  openAIContext?: string
  /** Rows for WhatsApp List Message — set when showing sede selection */
  sedesListRows?: Array<{ id: string; title: string; description?: string }>
  /** Buttons for WhatsApp Reply Buttons — set when showing search type prompt */
  searchTypeButtons?: Array<{ id: string; title: string }>
  /** Buttons for turnos pagination */
  turnosButtons?: Array<{ id: string; title: string }>
  /** True when message is a confirmation prompt */
  confirmationButtons?: boolean
  /** True when message needs a single "Volver a paso ant." button */
  atrasButton?: boolean
  /** Rows for WhatsApp List Message — set when showing the modify-data selection menu */
  modifyMenuRows?: Array<{ id: string; title: string; description?: string }>
}

/**
 * Obtiene el estado del flujo desde Redis
 */
async function getFlowState(phone: string): Promise<NewPatientFlowState | null> {
  const redis = getRedisClient()
  if (!redis) return null

  const stateKey = `${NEW_PATIENT_FLOW_KEY}:${phone}`
  const stateStr = await redis.get(stateKey)
  if (!stateStr) return null

  return typeof stateStr === 'object' ? stateStr as NewPatientFlowState : JSON.parse(stateStr as string)
}

/**
 * Guarda el estado del flujo en Redis
 */
async function saveFlowState(phone: string, state: NewPatientFlowState): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  state.lastUpdated = Date.now()
  const stateKey = `${NEW_PATIENT_FLOW_KEY}:${phone}`
  await redis.setex(stateKey, NEW_PATIENT_FLOW_TTL, JSON.stringify(state))
}

/**
 * Inicializa el flujo de paciente nuevo
 */
export async function initializeNewPatientFlow(
  dni: string,
  phone: string,
  clientId: string,
  esFamiliar?: boolean,
  initialMessage?: string
): Promise<NewPatientResult> {
  const logger = createConversationLogger(phone, clientId, 'new_patient_init')
  logger.info('Initializing new patient flow', { dni, esFamiliar })

  const flags = await getEffectiveFeatureFlags(clientId)
  if (!flags.directPacienteNuevo) {
    return {
      handled: false,
      shouldCallOpenAI: true,
      openAIContext: 'Use route_to_pacienteNuevo',
    }
  }

  const state: NewPatientFlowState = {
    phase: 'awaiting_apellido',
    dni,
    phone,
    obraSocialValidada: false,
    esFamiliar: esFamiliar === true,
    attempts: 0,
    turnosMostrados: 0,
    createdAt: Date.now(),
    lastUpdated: Date.now(),
  }

  // --- Slot filling: extraer entidades del mensaje inicial si está disponible ---
  if (initialMessage && flags.entityExtraction) {
    try {
      const history = flags.conversationHistory ? await getHistory(phone) : []
      const extraction = await extractEntities(initialMessage, history, true)

      if (extraction.hasData) {
        logger.info('Entity extraction on init', { entities: extraction.entities })

        if (extraction.entities.nombre) state.nombre = extraction.entities.nombre
        if (extraction.entities.apellido) state.apellido = extraction.entities.apellido
        if (extraction.entities.profesional) {
          // Guardamos el nombre mencionado — se usará como búsqueda en awaiting_professional_name
          // (el flujo ya busca por nombre de texto libre)
          ;(state as any)._profesionalMencionado = extraction.entities.profesional
        }
        // obra_social y motivo se usan como hints pero requieren validación API — no pre-llenar
      }
    } catch (err) {
      logger.error('Entity extraction failed during init', err as Error)
    }
  }

  // Determinar el primer paso según datos ya disponibles
  if (state.nombre && state.apellido) {
    // Ya tenemos ambos datos → saltar al pedido de obra social
    state.phase = 'awaiting_obra_social'
    await saveFlowState(phone, state)
    logger.info('Skipping name phases (both extracted)', { nombre: state.nombre, apellido: state.apellido })

    const history = flags.conversationHistory ? await getHistory(phone) : []
    const mensaje = flags.humanizedResponses
      ? await generateObraSocialRequest(state.nombre, state.esFamiliar, history)
      : state.esFamiliar
        ? `Gracias. Ahora necesito saber la obra social o prepaga de *${state.nombre}*.\n\nEscribi el nombre (por ejemplo: OSDE, Swiss Medical, PAMI, etc.) o *Particular* si no tiene cobertura.`
        : `Gracias ${state.nombre}. Ahora necesito saber tu *obra social o prepaga*.\n\nEscribi el nombre (por ejemplo: OSDE, Swiss Medical, PAMI, etc.) o *Particular* si no tenés cobertura.`

    return {
      handled: true,
      message: mensaje,
      patientInfo: { dni, name: `${state.nombre} ${state.apellido}` },
    }
  }

  if (state.apellido && !state.nombre) {
    // Ya tenemos apellido → saltar directo a solicitar el nombre
    state.phase = 'awaiting_nombre'
    await saveFlowState(phone, state)
    logger.info('Skipping apellido phase (already extracted)', { apellido: state.apellido })
    const msgNombre = state.esFamiliar
      ? `Gracias. Ahora escribí el *nombre completo* del familiar (solo el nombre, sin apellido).\n\nPor ejemplo: *Juan Pablo*`
      : `Gracias. Ahora escribí tu *nombre completo* (solo el nombre, sin apellido).\n\nPor ejemplo: *Juan Pablo*`
    return { handled: true, message: msgNombre, patientInfo: { dni } }
  }

  await saveFlowState(phone, state)
  logger.info('Flow initialized, requesting apellido', {})

  const history = flags.conversationHistory ? await getHistory(phone) : []
  const mensaje = flags.humanizedResponses
    ? await generateWelcomeMessage(state.esFamiliar, history)
    : state.esFamiliar
      ? `Veo que es la primera vez con nosotros. Para registrarlo y agendar un turno, necesito algunos datos.\n\nPrimero, escribí el *apellido* de la persona que agendará el turno.\n\nPor ejemplo: *Pérez*`
      : `Veo que es tu primera vez con nosotros. Para registrarte y agendar un turno, necesito algunos datos.\n\nPrimero, escribí tu *apellido*.\n\nPor ejemplo: *Pérez*`

  return {
    handled: true,
    message: mensaje,
    patientInfo: { dni },
  }
}

/**
 * Procesa mensaje del usuario durante el flujo
 */
export async function handleNewPatientMessage(
  phone: string,
  userMessage: string,
  clientId: string,
  escalationPhoneNumber?: string,
  searchOptionsConfig?: SearchOptionsConfig
): Promise<NewPatientResult> {
  const logger = createConversationLogger(phone, clientId, 'new_patient_message')

  const state = await getFlowState(phone)
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
    return handleBackNavigation(phone, clientId, state, searchOptionsConfig)
  }

  // Router por fase
  let result: NewPatientResult
  switch (state.phase) {
    case 'awaiting_apellido':
      result = await handleApellidoPhase(phone, userMessage, clientId, state)
      break

    case 'awaiting_nombre':
      result = await handleNombrePhase(phone, userMessage, clientId, state)
      break

    case 'awaiting_obra_social':
      result = await handleObraSocialPhase(phone, userMessage, clientId, state, escalationPhoneNumber)
      break

    case 'awaiting_obra_social_selection':
      result = await handleObraSocialSelectionPhase(phone, userMessage, clientId, state, escalationPhoneNumber)
      break

    case 'awaiting_sede':
      result = await handleSedePhase(phone, userMessage, clientId, state, searchOptionsConfig, flowInterruptionEnabled, escalationPhoneNumber)
      break

    case 'awaiting_search_type':
      result = await handleSearchTypePhase(phone, userMessage, clientId, state, escalationPhoneNumber, searchOptionsConfig)
      break

    case 'awaiting_professional_name':
      result = await handleProfessionalNamePhase(phone, userMessage, clientId, state, escalationPhoneNumber)
      break

    case 'awaiting_professional_selection':
      result = await handleProfessionalSelectionPhase(phone, userMessage, clientId, state, escalationPhoneNumber, flowInterruptionEnabled)
      break

    case 'awaiting_specialty_selection':
      result = await handleSpecialtyPhase(phone, userMessage, clientId, state, escalationPhoneNumber, flowInterruptionEnabled)
      break

    case 'awaiting_turno_selection':
      result = await handleTurnoPhase(phone, userMessage, clientId, state, escalationPhoneNumber, flowInterruptionEnabled)
      break

    case 'awaiting_email':
      result = await handleEmailPhase(phone, userMessage, clientId, state)
      break

    case 'awaiting_confirmation':
      result = await handleConfirmationPhase(phone, userMessage, clientId, state)
      break

    case 'awaiting_modify_selection':
      result = await handleModifySelectionPhase(phone, userMessage, clientId, state, escalationPhoneNumber, searchOptionsConfig)
      break

    case 'awaiting_modify_nombre':
      result = await handleModifyNombrePhase(phone, userMessage, clientId, state)
      break

    case 'awaiting_modify_nombre_2':
      result = await handleModifyNombreStep2Phase(phone, userMessage, clientId, state)
      break

    case 'awaiting_modify_dni':
      result = await handleModifyDniPhase(phone, userMessage, clientId, state)
      break

    case 'awaiting_modify_obra_social':
      result = await handleModifyObraSocialPhase(phone, userMessage, clientId, state)
      break

    default:
      logger.warn('Unhandled phase', { phase: state.phase })
      return { handled: false, shouldCallOpenAI: true }
  }

  // Anexar centralmente la opción "Volver al paso anterior" al mensaje saliente.
  // Los handlers de paciente nuevo no devuelven nextPhase, por lo que usamos state.phase
  // (ya actualizado por el handler) para determinar el destino.
  if (result.handled && result.message && !result.shouldCallOpenAI && !result.action) {
    result.message = withBackOption(result.message, state.phase, 'new')
  }
  return result
}

/**
 * Maneja el comando "Volver al paso anterior" para el flujo de paciente nuevo.
 * Limpia los datos del paso actual, retrocede a la fase previa y re-renderiza su mensaje.
 * Si no hay paso previo (primer paso), devuelve action 'back_to_main_menu'.
 */
async function handleBackNavigation(
  phone: string,
  clientId: string,
  state: NewPatientFlowState,
  searchOptionsConfig?: SearchOptionsConfig
): Promise<NewPatientResult> {
  const logger = createConversationLogger(phone, clientId, 'back_navigation_new')
  const prev = getPreviousPhase(state.phase as string, { flow: 'new', searchType: state.searchType })

  if (prev === MAIN_MENU) {
    logger.info('[BACK] Sin paso previo, volviendo al menú principal', { phase: state.phase })
    await clearNewPatientFlow(phone, clientId)
    return { handled: true, action: 'back_to_main_menu' }
  }

  logger.info('[BACK] Retrocediendo de fase', { from: state.phase, to: prev })
  state.attempts = 0

  const reRender = (message: string, phase: string, extra?: Partial<NewPatientResult>): NewPatientResult => ({
    handled: true,
    message: withBackOption(message, phase, 'new'),
    ...extra,
  })

  switch (prev) {
    case 'awaiting_apellido': {
      state.nombre = undefined
      state.apellido = undefined
      state.obraSocialId = undefined
      state.obraSocialNombre = undefined
      state.obraSocialValidada = false
      state.obraSocialOpciones = undefined
      state.phase = 'awaiting_apellido'
      state.attempts = 0
      await saveFlowState(phone, state)
      const msg = state.esFamiliar
        ? `Por favor, escribí el *apellido* de la persona que agendará el turno.\n\nPor ejemplo: *Pérez*`
        : `Por favor, escribí tu *apellido*.\n\nPor ejemplo: *Pérez*`
      return reRender(msg, 'awaiting_apellido')
    }

    case 'awaiting_nombre': {
      state.nombre = undefined
      state.phase = 'awaiting_nombre'
      state.attempts = 0
      await saveFlowState(phone, state)
      const msg = state.esFamiliar
        ? `Por favor, escribí el *nombre completo* del familiar (solo el nombre, sin apellido).\n\nPor ejemplo: *Juan Pablo*`
        : `Por favor, escribí tu *nombre completo* (solo el nombre, sin apellido).\n\nPor ejemplo: *Juan Pablo*`
      return reRender(msg, 'awaiting_nombre')
    }

    case 'awaiting_obra_social': {
      state.obraSocialId = undefined
      state.obraSocialNombre = undefined
      state.obraSocialValidada = false
      state.obraSocialOpciones = undefined
      state.sedeId = undefined
      state.sedeNombre = undefined
      state.attempts = 0
      state.phase = 'awaiting_obra_social'
      await saveFlowState(phone, state)
      const msg = state.esFamiliar
        ? `Escribi el nombre de la *obra social o prepaga* del familiar (por ejemplo: OSDE, Swiss Medical, PAMI, etc.) o *Particular* si no tiene cobertura.`
        : `Escribi el nombre de tu *obra social o prepaga* (por ejemplo: OSDE, Swiss Medical, PAMI, etc.) o *Particular* si no tenes cobertura.`
      return reRender(msg, 'awaiting_obra_social')
    }

    case 'awaiting_sede': {
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
          return { handled: true, message: buildSedesErrorMessage() }
        }
        state.sedesOpciones = sedesResult.sedes
      }
      await saveFlowState(phone, state)
      const nombreCompleto = `${state.nombre || ''} ${state.apellido || ''}`.trim()
      return {
        handled: true,
        message: withBackOption(buildSedesMessage(state.sedesOpciones, nombreCompleto || undefined, state.obraSocialNombre), 'awaiting_sede', 'new'),
        sedesListRows: buildSedesListRows(state.sedesOpciones),
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
      await saveFlowState(phone, state)
      return reRender(buildSearchOptionsMessage(state.sedeNombre || '', searchOptionsConfig), 'awaiting_search_type', {
        searchTypeButtons: buildSearchOptionsButtons(searchOptionsConfig),
      })
    }

    case 'awaiting_professional_name': {
      state.profesionalId = undefined
      state.profesionalNombre = undefined
      state.profesionalesOpciones = undefined
      state.turnosOpciones = undefined
      state.turnoSeleccionado = undefined
      state.phase = 'awaiting_professional_name'
      await saveFlowState(phone, state)
      return reRender(buildProfessionalNameRequestMessage(), 'awaiting_professional_name', {
        atrasButton: true,
      })
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
          return { handled: true, message: buildSpecialtiesErrorMessage() }
        }
        state.especialidadesOpciones = espResult.especialidades
      }
      await saveFlowState(phone, state)
      return reRender(buildSpecialtiesMessage(state.especialidadesOpciones), 'awaiting_specialty_selection')
    }

    case 'awaiting_turno_selection': {
      state.turnoSeleccionado = undefined
      state.phase = 'awaiting_turno_selection'
      if (state.turnosOpciones && state.turnosOpciones.length > 0) {
        await saveFlowState(phone, state)
        const nombreCompleto = `${state.nombre || ''} ${state.apellido || ''}`.trim()
        return reRender(
          buildTurnosListMessage(state.turnosOpciones, nombreCompleto || undefined, state.sedeNombre, state.profesionalNombre),
          'awaiting_turno_selection',
          { turnosButtons: [] }
        )
      }
      await saveFlowState(phone, state)
      const turnosResult = await searchAndShowTurnos(phone, clientId, state)
      if (turnosResult.message) {
        turnosResult.message = withBackOption(turnosResult.message, state.phase, 'new')
      }
      return turnosResult
    }

    case 'awaiting_confirmation': {
      state.phase = 'awaiting_confirmation'
      await saveFlowState(phone, state)
      const nombreCompleto = `${state.nombre || ''} ${state.apellido || ''}`.trim()
      return reRender(
        buildConfirmationMessage(
          state.turnoSeleccionado!,
          nombreCompleto,
          state.sedeNombre,
          state.obraSocialNombre,
          {
            apellido: state.apellido,
            nombre: state.nombre,
            dni: state.dni,
            email: state.email,
            esFamiliar: state.esFamiliar,
          }
        ),
        'awaiting_confirmation',
        { confirmationButtons: true }
      )
    }

    default: {
      logger.warn('[BACK] Paso previo no manejado, volviendo al menú principal', { prev })
      await clearNewPatientFlow(phone, clientId)
      return { handled: true, action: 'back_to_main_menu' }
    }
  }
}

/**
 * Fase 1 de nombre: captura SOLO el apellido.
 */
async function handleApellidoPhase(
  phone: string,
  userMessage: string,
  clientId: string,
  state: NewPatientFlowState
): Promise<NewPatientResult> {
  const logger = createConversationLogger(phone, clientId, 'apellido_phase')

  const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
  const input = userMessage.trim()
  const parts = input.split(/\s+/).filter(Boolean)

  // Validar: solo letras y espacios, al menos 2 caracteres
  const soloLetras = /^[a-zA-ZáéíóúÁÉÍÓÚüÜñÑ\s'-]+$/
  if (!soloLetras.test(input) || input.length < 2) {
    state.attempts += 1
    await saveFlowState(phone, state)
    if (state.attempts >= 3) {
      return { handled: false, shouldCallOpenAI: true, openAIContext: 'Patient cannot provide valid apellido' }
    }
    const msg = state.esFamiliar
      ? `Por favor, escribí solo el *apellido* del familiar.\n\nPor ejemplo: *Pérez*`
      : `Por favor, escribí solo tu *apellido*.\n\nPor ejemplo: *Pérez*`
    return { handled: true, message: msg }
  }

  // Si ingresó más de 2 palabras, advertir que solo se necesita el apellido
  if (parts.length > 2) {
    state.attempts += 1
    await saveFlowState(phone, state)
    if (state.attempts >= 3) {
      return { handled: false, shouldCallOpenAI: true, openAIContext: 'Patient entering full name in apellido step' }
    }
    const msg = state.esFamiliar
      ? `Necesito *solo el apellido* del familiar (sin el nombre). Por ejemplo: *Pérez*`
      : `Necesito *solo tu apellido* (sin el nombre). Por ejemplo: *Pérez*`
    return { handled: true, message: msg }
  }

  state.apellido = parts.map(capitalize).join(' ')
  state.phase = 'awaiting_nombre'
  state.attempts = 0
  await saveFlowState(phone, state)
  logger.info('Apellido captured', { apellido: state.apellido })

  const msg = state.esFamiliar
    ? `Gracias. Ahora escribí el *nombre completo* del familiar (solo el nombre, sin apellido).\n\nPor ejemplo: *Juan Pablo*`
    : `Gracias. Ahora escribí tu *nombre completo* (solo el nombre, sin apellido).\n\nPor ejemplo: *Juan Pablo*`

  return { handled: true, message: msg }
}

/**
 * Fase 2 de nombre: captura SOLO el nombre (sin apellido).
 */
async function handleNombrePhase(
  phone: string,
  userMessage: string,
  clientId: string,
  state: NewPatientFlowState
): Promise<NewPatientResult> {
  const logger = createConversationLogger(phone, clientId, 'nombre_phase')

  const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
  const input = userMessage.trim()
  const parts = input.split(/\s+/).filter(Boolean)

  // Validar: solo letras y espacios, al menos 2 caracteres
  const soloLetras = /^[a-zA-ZáéíóúÁÉÍÓÚüÜñÑ\s'-]+$/
  if (!soloLetras.test(input) || input.length < 2) {
    state.attempts += 1
    await saveFlowState(phone, state)
    if (state.attempts >= 3) {
      return { handled: false, shouldCallOpenAI: true, openAIContext: 'Patient cannot provide valid nombre' }
    }
    const msg = state.esFamiliar
      ? `Por favor, escribí solo el *nombre completo* del familiar (sin apellido).\n\nPor ejemplo: *Juan Pablo*`
      : `Por favor, escribí solo tu *nombre completo* (sin apellido).\n\nPor ejemplo: *Juan Pablo*`
    return { handled: true, message: msg }
  }

  state.nombre = parts.map(capitalize).join(' ')
  state.phase = 'awaiting_obra_social'
  state.attempts = 0
  await saveFlowState(phone, state)
  logger.info('Nombre captured', { nombre: state.nombre, apellido: state.apellido })

  const obraSocialMsg = state.esFamiliar
    ? `Gracias. Ahora necesito saber la obra social o prepaga de *${state.nombre}*.\n\nEscribi el nombre (por ejemplo: OSDE, Swiss Medical, PAMI, etc.) o *Particular* si no tiene cobertura.`
    : `Gracias ${state.nombre}. Ahora necesito saber tu *obra social o prepaga*.\n\nEscribi el nombre (por ejemplo: OSDE, Swiss Medical, PAMI, etc.) o *Particular* si no tenés cobertura.`

  return {
    handled: true,
    message: obraSocialMsg,
    patientInfo: { dni: state.dni, name: `${state.nombre} ${state.apellido || ''}`.trim() },
  }
}

/**
 * Fase: Obra social (especifica de paciente nuevo)
 */
async function handleObraSocialPhase(
  phone: string,
  userMessage: string,
  clientId: string,
  state: NewPatientFlowState,
  escalationPhoneNumber?: string
): Promise<NewPatientResult> {
  const logger = createConversationLogger(phone, clientId, 'obra_social_phase')

  const input = userMessage.trim()

  try {
    const result = await validarObraSocial(clientId, input)

    // Error de API (conexión, timeout, etc.) — no confundir con "no encontrado"
    if (!result.exito) {
      logger.warn('API error al buscar obra social', { error: result.error })
      return {
        handled: true,
        message: `Hubo un problema técnico al consultar las obras sociales. Por favor, intentá de nuevo en unos minutos.\n\n0. *Volver al paso anterior*`,
      }
    }

    if (!result.datos || result.datos.total_encontradas === 0) {
      state.attempts += 1
      state.lastInvalidInput = input
      await saveFlowState(phone, state)

      if (state.attempts >= 3) {
        return {
          handled: false,
          shouldCallOpenAI: true,
          openAIContext: `Cannot validate health insurance: ${input}`,
        }
      }

      const noEncontradoMsg = state.esFamiliar
        ? `No encontre "${input}" en nuestro sistema. Por favor, verifica el nombre de la obra social del familiar e intenta nuevamente.\n\nSi no tiene cobertura, escribi *Particular*.`
        : `No encontre "${input}" en nuestro sistema. Por favor, verifica el nombre de tu obra social e intenta nuevamente.\n\nSi no tenes cobertura, escribi *Particular*.`

      return {
        handled: true,
        message: noEncontradoMsg,
      }
    }

    // Una sola obra social encontrada
    if (result.datos.total_encontradas === 1) {
      const obraSocial = result.datos.obras_sociales[0]
      
      // 🆕 VALIDAR SI PERMITE TURNOS ONLINE
      if (obraSocial.permite_turnos_online === false) {
        const numeroDerivacion = escalationPhoneNumber || '[NÚMERO DE DERIVACIÓN]'
        logger.warn('Obra social no permite turnos online', { 
          obraSocialId: obraSocial.id, 
          nombre: obraSocial.nombre 
        })
        
        const firstName = getFirstName(state.nombre || '')
        const gracias = firstName ? `Gracias ${firstName}. ` : ''
        const contactMsg = state.esFamiliar
          ? `${gracias}Lamentablemente, ${obraSocial.nombre} no está habilitada para agendar turnos por este medio.\n\nPara agendar el turno del familiar, por favor contactanos al: *${numeroDerivacion}*`
          : `${gracias}Lamentablemente, ${obraSocial.nombre} no está habilitada para agendar turnos por este medio.\n\nPara agendar tu turno, por favor contactanos al: *${numeroDerivacion}*`
        return {
          handled: true,
          message: contactMsg,
        }
      }
      
      state.obraSocialId = obraSocial.id
      state.obraSocialNombre = obraSocial.nombre
      state.obraSocialValidada = true
      state.attempts = 0
      await saveFlowState(phone, state)

      logger.info('Obra social validated', { obraSocialId: state.obraSocialId, nombre: state.obraSocialNombre })

      // Siguiente paso: obtener sedes
      return await transitionToSedes(phone, clientId, state)
    }

    // Multiples resultados - mostrar opciones y cambiar fase
    const opciones: ObraSocialOption[] = result.datos.obras_sociales.slice(0, 5).map((os, i) => ({
      numero: i + 1,
      id: os.id,
      nombre: os.nombre,
      razonSocial: os.razon_social,
      permite_turnos_online: os.permite_turnos_online, // 🆕 AGREGAR CAMPO
    }))
    
    let mensaje = `Encontre varias opciones para "${input}":\n\n`
    opciones.forEach((os) => {
      mensaje += `${os.numero}. ${os.nombre}\n`
    })
    mensaje += state.esFamiliar
      ? `\nResponde con el *numero* de la obra social del familiar.`
      : `\nResponde con el *numero* de tu obra social.`

    // Guardar opciones y cambiar fase a seleccion
    state.obraSocialOpciones = opciones
    state.phase = 'awaiting_obra_social_selection'
    state.attempts = 0
    await saveFlowState(phone, state)
    
    logger.info('Multiples obras sociales encontradas, esperando seleccion', { 
      count: opciones.length,
      opciones: opciones.map(o => o.nombre)
    })

    return {
      handled: true,
      message: mensaje,
    }
  } catch (error) {
    logger.error('Error validating obra social', error as Error)
    state.attempts += 1
    await saveFlowState(phone, state)

    const errorMsg = state.esFamiliar
      ? 'Ocurrio un error al validar la obra social del familiar. Por favor, intenta nuevamente.'
      : 'Ocurrio un error al validar tu obra social. Por favor, intenta nuevamente.'

    return {
      handled: true,
      message: errorMsg,
    }
  }
}

/**
 * Fase: Seleccion de obra social de opciones mostradas
 */
async function handleObraSocialSelectionPhase(
  phone: string,
  userMessage: string,
  clientId: string,
  state: NewPatientFlowState,
  escalationPhoneNumber?: string
): Promise<NewPatientResult> {
  const logger = createConversationLogger(phone, clientId, 'obra_social_selection_phase')

  if (!state.obraSocialOpciones || state.obraSocialOpciones.length === 0) {
    // No hay opciones guardadas, volver a pedir obra social
    state.phase = 'awaiting_obra_social'
    await saveFlowState(phone, state)
    const fallbackMsg = state.esFamiliar
      ? 'Por favor, escribi el nombre de la *obra social o prepaga* del familiar.\n\nSi no tiene cobertura, escribi *Particular*.'
      : 'Por favor, escribi el nombre de tu *obra social o prepaga*.\n\nSi no tenes cobertura, escribi *Particular*.'
    return {
      handled: true,
      message: fallbackMsg,
    }
  }

  const input = userMessage.trim()

  // Intentar extraer seleccion usando extractSelection (soporta "uno", "primero", "1", etc.)
  const selectionOptions = state.obraSocialOpciones.map((o) => ({
    index: o.numero - 1, // 0-based
    label: o.nombre,
  }))
  const selectionResult = extractSelection(input, selectionOptions)
  const selectedNum = (selectionResult.selected && selectionResult.selectedIndex !== undefined)
    ? selectionResult.selectedIndex + 1  // volver a 1-based para buscar por o.numero
    : null

  if (selectedNum !== null) {
    const selectedOption = state.obraSocialOpciones.find(o => o.numero === selectedNum)
    
    if (selectedOption) {
      // 🆕 VALIDAR SI PERMITE TURNOS ONLINE
      if (selectedOption.permite_turnos_online === false) {
        const numeroDerivacion = escalationPhoneNumber || '[NÚMERO DE DERIVACIÓN]'
        logger.warn('Obra social seleccionada no permite turnos online', { 
          id: selectedOption.id, 
          nombre: selectedOption.nombre 
        })
        
        const firstName = getFirstName(state.nombre || '')
        const gracias = firstName ? `Gracias ${firstName}. ` : ''
        const contactMsgSel = state.esFamiliar
          ? `${gracias}Lamentablemente, ${selectedOption.nombre} no está habilitada para agendar turnos por este medio.\n\nPara agendar el turno del familiar, por favor contactanos al: *${numeroDerivacion}*`
          : `${gracias}Lamentablemente, ${selectedOption.nombre} no está habilitada para agendar turnos por este medio.\n\nPara agendar tu turno, por favor contactanos al: *${numeroDerivacion}*`
        return {
          handled: true,
          message: contactMsgSel,
        }
      }
      
      state.obraSocialId = selectedOption.id
      state.obraSocialNombre = selectedOption.nombre
      state.obraSocialValidada = true
      state.obraSocialOpciones = undefined // Limpiar opciones
      state.attempts = 0
      await saveFlowState(phone, state)
      
      logger.info('Obra social seleccionada por numero', { 
        numero: selectedNum, 
        id: selectedOption.id, 
        nombre: selectedOption.nombre 
      })
      
      // Siguiente paso: obtener sedes
      return await transitionToSedes(phone, clientId, state)
    }
    
    // Numero fuera de rango
    state.attempts += 1
    await saveFlowState(phone, state)
    
    const maxOption = state.obraSocialOpciones.length
    return {
      handled: true,
      message: `No encontre la opcion ${selectedNum}. Por favor, responde con un numero del 1 al ${maxOption}.`,
    }
  }
  
  // No es un numero - el usuario puede estar escribiendo otro nombre de obra social
  // Volver a la fase de obra social para procesar como nueva busqueda
  logger.info('Input no numerico en seleccion de obra social, procesando como nueva busqueda', { input })
  state.phase = 'awaiting_obra_social'
  state.obraSocialOpciones = undefined
  await saveFlowState(phone, state)
  
  // Re-procesar el mensaje como si fuera una nueva busqueda de obra social
  return handleObraSocialPhase(phone, userMessage, clientId, state, escalationPhoneNumber)
}

/**
 * Transicion a fase de sedes
 */
async function transitionToSedes(
  phone: string,
  clientId: string,
  state: NewPatientFlowState
): Promise<NewPatientResult> {
  const logger = createConversationLogger(phone, clientId, 'transition_sedes')

  const sedesResult = await fetchSedes(clientId)
  if (!sedesResult.success || !sedesResult.sedes) {
    return {
      handled: true,
      message: buildSedesErrorMessage(),
    }
  }

  state.sedesOpciones = sedesResult.sedes

  logger.info('Transitioned to sedes', { count: sedesResult.sedes.length })

  const nombreCompleto = `${state.nombre} ${state.apellido}`

  // Si solo hay una sede, seleccionarla automáticamente y saltar al siguiente paso
  if (sedesResult.sedes.length === 1) {
    const unicaSede = sedesResult.sedes[0]
    logger.info('Single sede — auto-selecting', { sedeId: unicaSede.id, sedeName: unicaSede.nombre })
    state.sedeId = unicaSede.id
    state.sedeNombre = unicaSede.nombre
    state.phase = 'awaiting_search_type'
    await saveFlowState(phone, state)
    return {
      handled: true,
      message: buildSearchOptionsMessage(unicaSede.nombre, undefined),
      patientInfo: { dni: state.dni, name: nombreCompleto, healthInsurance: state.obraSocialNombre },
      searchTypeButtons: buildSearchOptionsButtons(undefined),
    }
  }

  state.phase = 'awaiting_sede'
  await saveFlowState(phone, state)

  // Para familiar: construir intro personalizada + lista de sedes
  let sedesMsg: string
  if (state.esFamiliar) {
    const primerNombre = state.nombre || ''
    let intro = primerNombre ? `Perfecto. ` : ``
    if (state.obraSocialNombre) {
      intro += `La cobertura de *${primerNombre}* es *${state.obraSocialNombre}*.\n\n`
    }
    sedesMsg = intro + buildSedesMessage(sedesResult.sedes)
  } else {
    sedesMsg = buildSedesMessage(sedesResult.sedes, nombreCompleto, state.obraSocialNombre)
  }

  return {
    handled: true,
    message: sedesMsg,
    sedesListRows: buildSedesListRows(sedesResult.sedes),
    patientInfo: {
      dni: state.dni,
      name: nombreCompleto,
      healthInsurance: state.obraSocialNombre,
    },
  }
}

/**
 * Fase: Seleccion de sede (reutiliza modulo compartido)
 */
async function handleSedePhase(
  phone: string,
  userMessage: string,
  clientId: string,
  state: NewPatientFlowState,
  searchOptionsConfig?: SearchOptionsConfig,
  flowInterruptionEnabled?: boolean,
  escalationPhoneNumber?: string
): Promise<NewPatientResult> {
  if (!state.sedesOpciones || state.sedesOpciones.length === 0) {
    return { handled: false, shouldCallOpenAI: true }
  }

  const interruptionOptions: SedeInterruptionOptions | undefined = flowInterruptionEnabled
    ? {
        originalSedesMessage: buildSedesMessage(state.sedesOpciones),
        escalationPhone: escalationPhoneNumber,
      }
    : undefined

  const result = await handleSedeSelectionShared(userMessage, state.sedesOpciones, phone, clientId, interruptionOptions)

  if (result.selectedSede) {
    state.sedeId = result.selectedSede.id
    state.sedeNombre = result.selectedSede.nombre
    state.phase = 'awaiting_search_type'
    state.attempts = 0
    await saveFlowState(phone, state)

    return {
      handled: true,
      message: buildSearchOptionsMessage(state.sedeNombre, searchOptionsConfig),
      searchTypeButtons: buildSearchOptionsButtons(searchOptionsConfig),
    }
  }

  state.attempts += 1
  await saveFlowState(phone, state)

  return {
    handled: true,
    message: result.message,
    sedesListRows: state.sedesOpciones ? buildSedesListRows(state.sedesOpciones) : undefined,
  }
}

/**
 * Fase: Tipo de busqueda (reutiliza modulo compartido)
 */
async function handleSearchTypePhase(
  phone: string,
  userMessage: string,
  clientId: string,
  state: NewPatientFlowState,
  escalationPhoneNumber?: string,
  searchOptionsConfig?: SearchOptionsConfig
): Promise<NewPatientResult> {
  const result = await handleSearchTypeSelection(userMessage, phone, clientId, searchOptionsConfig)

  if (result.searchType) {
    state.searchType = result.searchType
    state.attempts = 0

    if (result.searchType === 'medico_particular') {
      state.phase = 'awaiting_professional_name'
      await saveFlowState(phone, state)
      return {
        handled: true,
        message: buildProfessionalNameRequestMessage(),
        atrasButton: true,
      }
    }

    if (result.searchType === 'especialidad') {
      const espResult = await fetchSpecialties(clientId)
      if (!espResult.success || !espResult.especialidades) {
        return {
          handled: true,
          message: buildSpecialtiesErrorMessage(),
        }
      }

      state.especialidadesOpciones = espResult.especialidades
      state.phase = 'awaiting_specialty_selection'
      await saveFlowState(phone, state)

      return {
        handled: true,
        message: buildSpecialtiesMessage(espResult.especialidades),
      }
    }

    if (result.searchType === 'cualquier_medico') {
      return await searchAndShowTurnos(phone, clientId, state, escalationPhoneNumber)
    }

    if (result.searchType === 'cambiar_sede') {
      // Opcion "Buscar en otra sede": volver al paso de seleccion de sede.
      // Limpiar la sede y los filtros previos para empezar la busqueda en otra sede.
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
      await saveFlowState(phone, state)

      if (!state.sedesOpciones || state.sedesOpciones.length === 0) {
        return { handled: false, shouldCallOpenAI: true }
      }

      return {
        handled: true,
        message: buildSedesMessage(state.sedesOpciones),
        sedesListRows: buildSedesListRows(state.sedesOpciones),
      }
    }
  }

  return {
    handled: true,
    message: result.message,
  }
}

/**
 * Fase: Nombre del profesional
 */
async function handleProfessionalNamePhase(
  phone: string,
  userMessage: string,
  clientId: string,
  state: NewPatientFlowState,
  escalationPhoneNumber?: string
): Promise<NewPatientResult> {
  const result = await handleProfessionalNameInput(userMessage, clientId, phone)

  if (result.profesionales && result.profesionales.length > 0) {
    state.profesionalesOpciones = result.profesionales

    if (result.profesionales.length === 1) {
      state.profesionalId = result.profesionales[0].id
      state.profesionalNombre = result.profesionales[0].nombre
      await saveFlowState(phone, state)
      return await searchAndShowTurnos(phone, clientId, state, escalationPhoneNumber)
    }

    state.phase = 'awaiting_professional_selection'
    await saveFlowState(phone, state)

    return {
      handled: true,
      message: result.message,
    }
  }

  return {
    handled: true,
    message: result.message,
  }
}

/**
 * Fase: Seleccion de profesional
 */
async function handleProfessionalSelectionPhase(
  phone: string,
  userMessage: string,
  clientId: string,
  state: NewPatientFlowState,
  escalationPhoneNumber?: string,
  flowInterruptionEnabled?: boolean
): Promise<NewPatientResult> {
  if (!state.profesionalesOpciones) {
    return { handled: false, shouldCallOpenAI: true }
  }

  const interruptionOptions: ProfessionalInterruptionOptions | undefined = flowInterruptionEnabled && state.profesionalesOpciones.length > 0
    ? {
        originalProfessionalsMessage: buildProfessionalsListMessage(state.profesionalesOpciones, ''),
        escalationPhone: escalationPhoneNumber,
      }
    : undefined

  const result = await handleProfessionalSelection(userMessage, state.profesionalesOpciones, phone, clientId, interruptionOptions)

  if (result.selectedProfessional) {
    state.profesionalId = result.selectedProfessional.id
    state.profesionalNombre = result.selectedProfessional.nombre
    state.attempts = 0
    await saveFlowState(phone, state)

    return await searchAndShowTurnos(phone, clientId, state, escalationPhoneNumber)
  }

  return {
    handled: true,
    message: result.message,
  }
}

/**
 * Fase: Seleccion de especialidad
 */
async function handleSpecialtyPhase(
  phone: string,
  userMessage: string,
  clientId: string,
  state: NewPatientFlowState,
  escalationPhoneNumber?: string,
  flowInterruptionEnabled?: boolean
): Promise<NewPatientResult> {
  if (!state.especialidadesOpciones) {
    return { handled: false, shouldCallOpenAI: true }
  }

  const interruptionOptions: SpecialtyInterruptionOptions | undefined = flowInterruptionEnabled && state.especialidadesOpciones.length > 0
    ? {
        originalSpecialtiesMessage: buildSpecialtiesMessage(state.especialidadesOpciones),
        escalationPhone: escalationPhoneNumber,
      }
    : undefined

  const result = await handleSpecialtySelection(userMessage, state.especialidadesOpciones, phone, clientId, interruptionOptions)

  if (result.selectedSpecialty) {
    state.especialidadId = result.selectedSpecialty.id
    state.especialidadNombre = result.selectedSpecialty.nombre
    state.attempts = 0
    await saveFlowState(phone, state)

    return await searchAndShowTurnos(phone, clientId, state, escalationPhoneNumber)
  }

  return {
    handled: true,
    message: result.message,
  }
}

/**
 * Busca turnos y los muestra
 */
async function searchAndShowTurnos(
  phone: string,
  clientId: string,
  state: NewPatientFlowState,
  escalationPhoneNumber?: string
): Promise<NewPatientResult> {
  const logger = createConversationLogger(phone, clientId, 'turnos_search_new_patient')
  
  logger.info('[TURNOS] Iniciando busqueda de turnos (paciente nuevo)', {
    sedeId: state.sedeId,
    sedeNombre: state.sedeNombre,
    profesionalId: state.profesionalId,
    profesionalNombre: state.profesionalNombre,
    especialidadId: state.especialidadId,
    especialidadNombre: state.especialidadNombre,
    searchType: state.searchType,
    obraSocialId: state.obraSocialId,
    obraSocialNombre: state.obraSocialNombre,
  })

  const result = await searchTurnosFull(
    clientId,
    {
      sedeId: state.sedeId!,
      obraSocialId: state.obraSocialId, // Paciente nuevo usa obra social ID
      profesionalId: state.profesionalId,
      especialidadId: state.especialidadId,
    },
    phone
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
    await saveFlowState(phone, state)
    
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
      nextPhase: 'awaiting_search_type', // Volver a opciones de busqueda
    }
  }

  // Guardar array completo de 60 días y mostrar primera ventana de 15 días
  state.turnosOpciones = result.turnos
  state.turnosMostrados = 0
  state.phase = 'awaiting_turno_selection'
  await saveFlowState(phone, state)

  logger.info('[TURNOS] Turnos encontrados', { total: result.turnos.length })

  const window = getNextWindow(result.turnos, 0)
  state.turnosMostrados = window.newShownCount
  await saveFlowState(phone, state)

  const nombreCompleto = `${state.nombre || ''} ${state.apellido || ''}`.trim()
  return {
    handled: true,
    message: buildTurnosWindowMessage(
      window.turnos,
      result.turnos.length,
      window.hasMore,
      nombreCompleto || undefined,
      state.sedeNombre,
      state.profesionalNombre,
      true
    ),
    turnosButtons: window.hasMore ? [{ id: 'ver_mas', title: 'Ver más' }] : [],
  }
}

/**
 * Fase: Selección de turno.
 * Maneja selección directa, paginación y filtros de texto libre.
 */
async function handleTurnoPhase(
  phone: string,
  userMessage: string,
  clientId: string,
  state: NewPatientFlowState,
  escalationPhoneNumber?: string,
  flowInterruptionEnabled?: boolean
): Promise<NewPatientResult> {
  if (!state.turnosOpciones) {
    return { handled: false, shouldCallOpenAI: true }
  }

  const interruptionOptions: TurnoInterruptionOptions | undefined = flowInterruptionEnabled
    ? {
        originalTurnosMessage: buildInvalidSelectionMessage(state.turnosOpciones, state.searchType),
        escalationPhone: escalationPhoneNumber,
      }
    : undefined

  const result = await handleTurnoSelection(
    userMessage,
    state.turnosOpciones,
    phone,
    clientId,
    state.searchType,
    interruptionOptions,
    state.profesionalNombre
  )

  // ── "Ver más": mostrar la siguiente ventana de 15 días ──────────────────
  if (result.showMore) {
    const window = getNextWindow(state.turnosOpciones, state.turnosMostrados)
    if (window.turnos.length === 0) {
      return {
        handled: true,
        message: `_Esos son todos los turnos disponibles en los próximos 60 días. ¿Cuál deseás elegir?_`,
        turnosButtons: [],
      }
    }
    state.turnosMostrados = window.newShownCount
    await saveFlowState(phone, state)
    return {
      handled: true,
      message: buildTurnosWindowMessage(
        window.turnos,
        state.turnosOpciones.length,
        window.hasMore,
        undefined,
        state.sedeNombre,
        state.profesionalNombre,
        false
      ),
      turnosButtons: window.hasMore ? [{ id: 'ver_mas', title: 'Ver más' }] : [],
    }
  }

  // ── "Ver todos": volver a la primera ventana sin filtro ─────────────────
  if (result.showAll) {
    const window = getNextWindow(state.turnosOpciones, 0)
    state.turnosMostrados = window.newShownCount
    await saveFlowState(phone, state)
    const nombreCompleto = `${state.nombre || ''} ${state.apellido || ''}`.trim()
    return {
      handled: true,
      message: buildTurnosWindowMessage(
        window.turnos,
        state.turnosOpciones.length,
        window.hasMore,
        nombreCompleto || undefined,
        state.sedeNombre,
        state.profesionalNombre,
        true
      ),
      turnosButtons: window.hasMore ? [{ id: 'ver_mas', title: 'Ver más' }] : [],
    }
  }

  // ── Resultado filtrado: mostrar subconjunto con números originales ───────
  if (result.filteredTurnos && result.filteredMessage) {
    // No avanzamos turnosMostrados — el filtro no es paginación
    return { handled: true, message: result.filteredMessage }
  }

  // ── Turno seleccionado ───────────────────────────────────────────────────
  if (result.selectedTurno) {
    state.turnoSeleccionado = result.selectedTurno
    state.attempts = 0

    if (!state.email) {
      state.phase = 'awaiting_email'
      await saveFlowState(phone, state)
      const emailMsg = state.esFamiliar
        ? `Para confirmar el turno, necesito el *correo electrónico* de ${state.nombre || 'el familiar'}.\n\nPor favor, escribí su email para enviarle la confirmación del turno.`
        : buildEmailRequestMessage()
      return { handled: true, message: emailMsg }
    }

    state.phase = 'awaiting_confirmation'
    await saveFlowState(phone, state)

    const nombreCompleto = `${state.nombre || ''} ${state.apellido || ''}`.trim()
    return {
      handled: true,
      message: buildConfirmationMessage(
        result.selectedTurno,
        nombreCompleto,
        state.sedeNombre,
        state.obraSocialNombre,
        { apellido: state.apellido, nombre: state.nombre, dni: state.dni, telefono: state.telefono, esFamiliar: state.esFamiliar }
      ),
      confirmationButtons: true,
    }
  }

  return { handled: true, message: result.message }
}

/**
 * Fase: Email (obligatorio para paciente nuevo)
 */
async function handleEmailPhase(
  phone: string,
  userMessage: string,
  clientId: string,
  state: NewPatientFlowState
): Promise<NewPatientResult> {
  const result = await handleEmailInputShared(userMessage, phone, clientId, state.attempts)

  if (result.validatedEmail) {
    state.email = result.validatedEmail
    state.phase = 'awaiting_confirmation'
    state.attempts = 0
    await saveFlowState(phone, state)

    const nombreCompleto = `${state.nombre} ${state.apellido}`
    return {
      handled: true,
      message: buildConfirmationMessage(
        state.turnoSeleccionado!,
        nombreCompleto,
        state.sedeNombre,
        state.obraSocialNombre,
        {
          apellido: state.apellido,
          nombre: state.nombre,
          dni: state.dni,
          telefono: state.telefono,
          email: state.email,
          esFamiliar: state.esFamiliar,
        }
      ),
      confirmationButtons: true,
    }
  }

  if (result.nextPhase === 'abandoned') {
    await clearNewPatientFlow(phone, clientId)
    return {
      handled: true,
      message: result.message,
    }
  }

  // Si aún no se recibió el email y el mensaje de error viene del handler compartido,
  // adaptarlo para modo familiar si corresponde
  if (state.esFamiliar && result.message?.includes('tu email')) {
    return {
      handled: true,
      message: result.message.replace('tu email', `el email de ${state.nombre || 'el familiar'}`),
    }
  }

  state.attempts += 1
  await saveFlowState(phone, state)

  return {
    handled: true,
    message: result.message,
  }
}

/**
 * Fase: Confirmacion y reserva
 */
async function handleConfirmationPhase(
  phone: string,
  userMessage: string,
  clientId: string,
  state: NewPatientFlowState
): Promise<NewPatientResult> {
  const logger = createConversationLogger(phone, clientId, 'confirmation_phase')

  const result = await handleConfirmationResponse(userMessage, phone, clientId)

  if (result.confirmed === true) {
    const reservaResult = await executeReservation(
      clientId,
      state.turnoSeleccionado!,
      {
        nombre: state.nombre,
        apellido: state.apellido,
        dni: state.dni,
        telefono: phone,
        email: state.email!,
        obraSocialId: state.obraSocialId,
        obraSocialNombre: state.obraSocialNombre,
      },
      phone
    )

    if (reservaResult.success) {
      state.phase = 'completed'
      await saveFlowState(phone, state)

      logger.info('Reserva exitosa', { turnoId: state.turnoSeleccionado?.id })

      return {
        handled: true,
        message: reservaResult.message,
        action: 'turno_reservado',
        patientInfo: {
          dni: state.dni,
          name: `${state.nombre} ${state.apellido}`,
          email: state.email,
          healthInsurance: state.obraSocialNombre,
        },
      }
    }

    return {
      handled: true,
      message: reservaResult.message,
    }
  }

  if (result.confirmed === false && result.nextPhase === 'awaiting_modify_selection') {
    state.phase = 'awaiting_modify_selection'
    await saveFlowState(phone, state)
    return {
      handled: true,
      message: result.message,
      modifyMenuRows: buildModifyMenuRows(),
    }
  }

  if (result.confirmed === false && result.nextPhase === 'abandoned') {
    await clearNewPatientFlow(phone, clientId)
    return {
      handled: true,
      message: result.message,
    }
  }

  return {
    handled: true,
    message: result.message,
  }
}

/**
 * Filas para el WhatsApp List Message del menú de modificación de datos
 */
function buildModifyMenuRows(): Array<{ id: string; title: string; description?: string }> {
  return [
    { id: 'nombre', title: 'Nombre y Apellido', description: 'Corregir nombre o apellido' },
    { id: 'dni', title: 'DNI', description: 'Corregir número de documento' },
    { id: 'obra_social', title: 'Obra Social', description: 'Cambiar cobertura médica' },
    { id: 'turno', title: 'Modificar turno', description: 'Elegir otro día u horario' },
  ]
}

/**
 * Fase: Modificar Nombre - Paso 1: Apellido
 */
async function handleModifyNombrePhase(
  phone: string,
  userMessage: string,
  clientId: string,
  state: NewPatientFlowState
): Promise<NewPatientResult> {
  const logger = createConversationLogger(phone, clientId, 'modify_nombre_phase')

  const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
  const input = userMessage.trim()
  const soloLetras = /^[a-zA-ZáéíóúÁÉÍÓÚüÜñÑ\s'-]+$/

  if (!soloLetras.test(input) || input.length < 2) {
    const msg = state.esFamiliar
      ? `Por favor, escribí solo el *apellido* del familiar.\n\nPor ejemplo: *Pérez*`
      : `Por favor, escribí solo tu *apellido*.\n\nPor ejemplo: *Pérez*`
    return { handled: true, message: msg, atrasButton: true }
  }

  state.apellido = input.split(/\s+/).map(capitalize).join(' ')
  state.phase = 'awaiting_modify_nombre_2'
  await saveFlowState(phone, state)

  logger.info('Apellido updated in modify flow', { apellido: state.apellido })

  const msg = state.esFamiliar
    ? `Gracias. Ahora escribí el *nombre* completo del familiar (solo el nombre, sin apellido).\n\nPor ejemplo: *Juan Pablo*`
    : `Gracias. Ahora escribí tu *nombre* completo (solo el nombre, sin apellido).\n\nPor ejemplo: *Juan Pablo*`
  return { handled: true, message: msg, atrasButton: true }
}

/**
 * Fase: Modificar Nombre - Paso 2: Nombre
 */
async function handleModifyNombreStep2Phase(
  phone: string,
  userMessage: string,
  clientId: string,
  state: NewPatientFlowState
): Promise<NewPatientResult> {
  const logger = createConversationLogger(phone, clientId, 'modify_nombre2_phase')

  const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
  const input = userMessage.trim()
  const soloLetras = /^[a-zA-ZáéíóúÁÉÍÓÚüÜñÑ\s'-]+$/

  if (!soloLetras.test(input) || input.length < 2) {
    const msg = state.esFamiliar
      ? `Por favor, escribí solo el *nombre* del familiar (sin apellido).\n\nPor ejemplo: *Juan Pablo*`
      : `Por favor, escribí solo tu *nombre* (sin apellido).\n\nPor ejemplo: *Juan Pablo*`
    return { handled: true, message: msg, atrasButton: true }
  }

  state.nombre = input.split(/\s+/).map(capitalize).join(' ')
  state.phase = 'awaiting_confirmation'
  await saveFlowState(phone, state)

  logger.info('Nombre updated in modify flow', { nombre: state.nombre, apellido: state.apellido })

  const nombreCompleto = `${state.nombre} ${state.apellido}`
  return {
    handled: true,
    message: buildConfirmationMessage(
      state.turnoSeleccionado!,
      nombreCompleto,
      state.sedeNombre,
      state.obraSocialNombre,
      { apellido: state.apellido, nombre: state.nombre, dni: state.dni, telefono: phone, email: state.email, esFamiliar: state.esFamiliar }
    ),
    confirmationButtons: true,
  }
}

/**
 * Fase: Modificar DNI (paciente nuevo)
 */
async function handleModifyDniPhase(
  phone: string,
  userMessage: string,
  clientId: string,
  state: NewPatientFlowState
): Promise<NewPatientResult> {
  const logger = createConversationLogger(phone, clientId, 'modify_dni_phase')

  const input = userMessage.trim().replace(/[.\s-]/g, '')

  if (!/^\d{7,9}$/.test(input)) {
    return {
      handled: true,
      message: `El DNI ingresado no es valido. Por favor, escribi solo numeros (sin puntos ni espacios).`,
    }
  }

  state.dni = input
  state.phase = 'awaiting_confirmation'
  await saveFlowState(phone, state)

  logger.info('DNI updated', { dni: input })

  const nombreCompleto = `${state.nombre} ${state.apellido}`
  return {
    handled: true,
    message: buildConfirmationMessage(
      state.turnoSeleccionado!,
      nombreCompleto,
      state.sedeNombre,
      state.obraSocialNombre,
      { apellido: state.apellido, nombre: state.nombre, dni: state.dni, telefono: phone, email: state.email, esFamiliar: state.esFamiliar }
    ),
    confirmationButtons: true,
  }
}

/**
 * Fase: Modificar Obra Social (paciente nuevo)
 */
async function handleModifyObraSocialPhase(
  phone: string,
  userMessage: string,
  clientId: string,
  state: NewPatientFlowState
): Promise<NewPatientResult> {
  const logger = createConversationLogger(phone, clientId, 'modify_obra_social_phase')

  const input = userMessage.trim()

  try {
    const result = await validarObraSocial(clientId, input)

    if (!result.exito) {
      logger.warn('API error al buscar obra social (modify)', { error: result.error })
      return {
        handled: true,
        message: `Hubo un problema técnico al consultar las obras sociales. Por favor, intentá de nuevo en unos minutos.\n\n0. *Volver al paso anterior*`,
      }
    }

    if (!result.datos || result.datos.total_encontradas === 0) {
      const noEncontradoModify = state.esFamiliar
        ? `No encontre "${input}" en nuestro sistema. Por favor, verifica el nombre de la obra social del familiar e intenta nuevamente.\n\nSi no tiene cobertura, escribi *Particular*.`
        : `No encontre "${input}" en nuestro sistema. Por favor, verifica el nombre de tu obra social e intenta nuevamente.\n\nSi no tenes cobertura, escribi *Particular*.`
      return {
        handled: true,
        message: noEncontradoModify,
      }
    }

    const obraSocial = result.datos.obras_sociales[0]
    state.obraSocialId = obraSocial.id
    state.obraSocialNombre = obraSocial.nombre
    state.obraSocialValidada = true
    state.phase = 'awaiting_confirmation'
    await saveFlowState(phone, state)

    logger.info('Obra social updated', { obraSocialNombre: obraSocial.nombre })

    const nombreCompleto = `${state.nombre} ${state.apellido}`
    return {
      handled: true,
      message: buildConfirmationMessage(
        state.turnoSeleccionado!,
        nombreCompleto,
        state.sedeNombre,
        state.obraSocialNombre,
        { apellido: state.apellido, nombre: state.nombre, dni: state.dni, telefono: phone, email: state.email, esFamiliar: state.esFamiliar }
      ),
      confirmationButtons: true,
    }
  } catch (error) {
    logger.error('Error validating obra social', error as Error)
    return {
      handled: true,
      message: `Ocurrio un error al validar la obra social. Por favor, intenta nuevamente.`,
    }
  }
}

/**
 * Fase: Seleccion de dato a modificar (paciente nuevo)
 */
async function handleModifySelectionPhase(
  phone: string,
  userMessage: string,
  clientId: string,
  state: NewPatientFlowState,
  escalationPhoneNumber?: string,
  searchOptionsConfig?: SearchOptionsConfig
): Promise<NewPatientResult> {
  const logger = createConversationLogger(phone, clientId, 'modify_selection_phase')

  const option = detectModifyDataOption(userMessage)

  if (!option) {
    return {
      handled: true,
      message: `No entendi tu respuesta. Por favor, seleccioná una opción:\n\n${buildModifyDataMenu()}`,
      modifyMenuRows: buildModifyMenuRows(),
    }
  }

  logger.info('Modify option selected', { option })

  if (option === 'nombre') {
    state.phase = 'awaiting_modify_nombre'
    await saveFlowState(phone, state)
    const msgNombre = state.esFamiliar
      ? `Primero, escribí el *apellido* de la persona que agendará el turno.\n\nPor ejemplo: *Pérez*`
      : `Primero, escribí tu *apellido*.\n\nPor ejemplo: *Pérez*`
    return { handled: true, message: msgNombre, atrasButton: true }
  }

  if (option === 'dni') {
    state.phase = 'awaiting_modify_dni'
    await saveFlowState(phone, state)
    const msgDni = state.esFamiliar
      ? `Por favor, escribi el *DNI* del familiar corregido (solo numeros, sin puntos ni espacios).`
      : `Por favor, escribi tu *DNI* corregido (solo numeros, sin puntos ni espacios).`
    return { handled: true, message: msgDni, atrasButton: true }
  }

  if (option === 'obra_social') {
    state.phase = 'awaiting_modify_obra_social'
    await saveFlowState(phone, state)
    const msgOS = state.esFamiliar
      ? `Por favor, escribi el nombre de la *obra social o prepaga* del familiar.\n\nSi no tiene cobertura, escribi *Particular*.`
      : `Por favor, escribi el nombre de tu *obra social o prepaga*.\n\nSi no tenes cobertura, escribi *Particular*.`
    return { handled: true, message: msgOS, atrasButton: true }
  }

  if (option === 'turno') {
    // Reiniciar desde sede conservando datos del paciente
    const sedesResult = await fetchSedes(clientId)
    if (!sedesResult.success || !sedesResult.sedes) {
      return {
        handled: true,
        message: buildSedesErrorMessage(),
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
    await saveFlowState(phone, state)

    logger.info('Restarting from sede for turno modification', {})

    const nombreCompleto = `${state.nombre} ${state.apellido}`
    return {
      handled: true,
      message: buildSedesMessage(sedesResult.sedes, nombreCompleto, state.obraSocialNombre),
      sedesListRows: buildSedesListRows(sedesResult.sedes),
    }
  }

  return { handled: false }
}

/**
 * Verifica si el flujo esta activo
 */
export async function isNewPatientFlowActive(phone: string): Promise<boolean> {
  const state = await getFlowState(phone)
  return !!state && state.phase !== 'completed' && state.phase !== 'abandoned'
}

/**
 * Obtiene el estado del flujo
 */
export async function getNewPatientState(phone: string): Promise<NewPatientFlowState | null> {
  return getFlowState(phone)
}

/**
 * Limpia el flujo
 */
export async function clearNewPatientFlow(phone: string, clientId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  const logger = createConversationLogger(phone, clientId, 'new_patient_clear')
  await redis.del(`${NEW_PATIENT_FLOW_KEY}:${phone}`)
  logger.info('Flow cleared', {})
}

/**
 * Verifica si debe usar el flujo directo
 */
export async function shouldUseNewPatientFlow(
  phone: string,
  clientId: string
): Promise<boolean> {
  const isActive = await isNewPatientFlowActive(phone)
  if (isActive) return true

  const flags = await getEffectiveFeatureFlags(clientId)
  return flags.directPacienteNuevo
}
