/**
 * Adaptador del widget de FORMULARIO (tercer tipo de widget embebible, 9/7/2026).
 *
 * A diferencia de widget-chat-flow.ts (que colapsa cada paso a un mensaje de
 * texto plano, pensado para una interfaz de chat), este módulo devuelve el
 * paso actual del flujo compartido en forma ESTRUCTURADA: qué tipo de control
 * mostrar (input de texto, select, botones, datepicker + horarios,
 * confirmación) y con qué datos (opciones reales de obra social/sede/
 * profesional/especialidad, turnos con fecha y hora), para que el frontend
 * (components/widget-form.tsx) renderice elementos HTML nativos en vez de
 * burbujas de chat.
 *
 * Reutiliza EXACTAMENTE el mismo motor de agendamiento que ya usan WhatsApp y
 * el widget de chat — no duplica lógica de negocio, ni de validación, ni de
 * reserva. La clave que lo permite: todas las fases de "elegir una opción"
 * (obra social, sede, tipo de búsqueda, profesional, especialidad, turno,
 * confirmación, menú de modificación) ya aceptan una simple selección
 * numérica como texto ("1", "2", "15", etc. — el mismo `numero` que ya traen
 * los objetos de opciones). Confirmado leyendo confirmation-handler.ts,
 * search-options-handler.ts y turno-selection-handler.ts. Así que este
 * adaptador arma la UI a partir del estado guardado en Redis (vía los
 * getters de sólo lectura `getNewPatientFlowSnapshot`/
 * `getExistingPatientFlowSnapshot`) y, cuando el visitante interactúa con un
 * botón/select/datepicker, simplemente le manda al motor el `numero` elegido
 * como si fuera la respuesta de texto de un chat.
 */

import { ClinicAPI } from '../../clinic-api'
import { createConversationLogger } from '../logger'
import { getConfigByClienteId } from '../../db'
import {
  initializeNewPatientFlow,
  handleNewPatientMessage,
  isNewPatientFlowActive,
  getNewPatientFlowSnapshot,
  type NewPatientFlowState,
  type NewPatientResult,
} from '../new-patient/new-patient-flow-integration'
import {
  initializeExistingPatientFlow,
  handleExistingPatientMessage,
  isExistingPatientFlowActive,
  getExistingPatientFlowSnapshot,
  type ExistingPatientFlowState,
  type ExistingPatientResult,
} from '../existing-patient/existing-patient-flow-integration'
import { buildSearchOptionsButtons, type SearchOptionsConfig } from '../shared/search-options-handler'
import { backKindForPhase, type FlowKind } from '../shared/back-navigation'
import type {
  ObraSocialOption,
  SedeOption,
  ProfessionalOption,
  SpecialtyOption,
  TurnoOption,
} from '../shared/types'

// ─── Contrato con el frontend ────────────────────────────────────────────────

export type FormWidgetInputType =
  | 'dni'
  | 'text'
  | 'email'
  | 'tel'
  | 'select'
  | 'search-type'
  | 'turno-picker'
  | 'confirmation'
  | 'info'

export interface FormWidgetOption {
  id: string
  label: string
  description?: string
}

export interface FormWidgetTurno {
  numero: number
  fecha: string
  hora: string
  profesionalNombre: string
  especialidad?: string
  sedeNombre?: string
}

export interface FormWidgetSummary {
  dni?: string
  nombreCompleto?: string
  obraSocial?: string
  sede?: string
  turno?: { fecha: string; hora: string; profesionalNombre: string; sedeNombre?: string }
  email?: string
  telefono?: string
}

export interface FormWidgetStep {
  phase: string
  done: boolean
  success?: boolean
  message: string
  inputType: FormWidgetInputType
  fieldLabel?: string
  placeholder?: string
  options?: FormWidgetOption[]
  turnos?: FormWidgetTurno[]
  summary?: FormWidgetSummary
  canGoBack?: boolean
}

const DNI_MESSAGE = 'Para comenzar, ingresá tu número de DNI (sin puntos).'
const FEATURE_DISABLED_MESSAGE =
  'Este servicio no está disponible por el momento. Por favor, contactanos directamente para agendar tu turno.'

function dniStep(message: string = DNI_MESSAGE): FormWidgetStep {
  return { phase: 'awaiting_dni', done: false, message, inputType: 'dni', canGoBack: false }
}

function infoStep(message: string, success: boolean, phase: string): FormWidgetStep {
  return { phase, done: true, success, message, inputType: 'info', canGoBack: false }
}

/**
 * Extrae un DNI del mensaje del visitante. DNI argentino: 7 u 8 dígitos.
 * (Misma lógica que widget-chat-flow.ts — se mantiene independiente a
 * propósito para no acoplar los dos adaptadores entre sí.)
 */
function extractDNI(userMessage: string): string | null {
  const digits = (userMessage || '').replace(/[^0-9]/g, '')
  if (digits.length >= 7 && digits.length <= 8) return digits
  return null
}

/**
 * Trae los flags de búsqueda configurados para la clínica (mismos campos que
 * ya usa WhatsApp — lib/whatsapp.tsx, líneas ~4094-4098). widget-chat-flow.ts
 * (el widget de chat) no los pasa todavía y por eso siempre muestra las 3
 * opciones de búsqueda sin importar la configuración — acá sí se respetan,
 * para no repetir esa inconsistencia en el widget nuevo.
 */
async function getSearchOptionsConfig(clientId: string): Promise<SearchOptionsConfig | undefined> {
  try {
    const config = await getConfigByClienteId(clientId)
    if (!config) return undefined
    return {
      enableSearchByProfessional: config.enableSearchByProfessional !== false,
      enableSearchBySpecialty: config.enableSearchBySpecialty !== false,
      enableSearchByAnyDoctor: config.enableSearchByAnyDoctor !== false,
    }
  } catch {
    return undefined
  }
}

// ─── Punto de entrada ────────────────────────────────────────────────────────

/**
 * @param init Cuando es `true`, no interpreta `userMessage` — sólo devuelve el
 * paso actual (si ya había un flujo en curso, ej. el visitante recargó la
 * página a mitad de camino) o el pedido de DNI inicial. Se usa en el primer
 * fetch del componente, antes de que el visitante haya escrito nada.
 */
export async function processWidgetFormMessage(
  sessionId: string,
  userMessage: string,
  clientId: string,
  escalationPhoneNumber?: string,
  init: boolean = false
): Promise<FormWidgetStep> {
  const logger = createConversationLogger(sessionId, clientId, 'widget_form')

  try {
    const searchOptionsConfig = await getSearchOptionsConfig(clientId)

    if (init) {
      if (await isNewPatientFlowActive(sessionId)) {
        const snap = await getNewPatientFlowSnapshot(sessionId)
        if (snap) return buildNewPatientStep(snap, searchOptionsConfig)
      }
      if (await isExistingPatientFlowActive(sessionId)) {
        const snap = await getExistingPatientFlowSnapshot(sessionId)
        if (snap) return buildExistingPatientStep(snap, searchOptionsConfig)
      }
      return dniStep()
    }

    // ── Flujo de paciente nuevo ya activo ──────────────────────────────────
    if (await isNewPatientFlowActive(sessionId)) {
      const result = await handleNewPatientMessage(
        sessionId,
        userMessage,
        clientId,
        escalationPhoneNumber,
        searchOptionsConfig
      )
      return await finalizeNewPatient(sessionId, result, searchOptionsConfig)
    }

    // ── Flujo de paciente existente ya activo ──────────────────────────────
    if (await isExistingPatientFlowActive(sessionId)) {
      const result = await handleExistingPatientMessage(
        sessionId,
        userMessage,
        clientId,
        escalationPhoneNumber,
        searchOptionsConfig
      )
      return await finalizeExistingPatient(sessionId, result, searchOptionsConfig)
    }

    // ── Sin flujo activo: el mensaje debería ser el DNI ────────────────────
    const dni = extractDNI(userMessage)
    if (!dni) {
      return dniStep('Ese DNI no parece válido. Ingresá sólo los números (7 u 8 dígitos).')
    }

    logger.info('DNI recibido en widget de formulario, validando paciente', {})
    const clinicAPI = new ClinicAPI(clientId)
    const patientResponse = await clinicAPI.paciente_dni(dni)

    if (!patientResponse.exito || !patientResponse.datos) {
      // No encontrado → paciente nuevo
      const result = await initializeNewPatientFlow(dni, sessionId, clientId, false, userMessage, 'widget')
      return await finalizeNewPatient(sessionId, result, searchOptionsConfig)
    }

    // Encontrado → paciente existente. Misma normalización que widget-chat-flow.ts
    // y que lib/whatsapp.tsx (la API responde en formatos ligeramente distintos
    // según el caso: paciente único, pacientes_multiples, array plano u objeto).
    const patientData = patientResponse.datos as any
    let patient: any
    if (patientData.paciente) {
      patient = patientData.paciente
    } else if (
      patientData.warning === 'pacientes_multiples' &&
      Array.isArray(patientData.pacientes) &&
      patientData.pacientes.length > 0
    ) {
      patient = patientData.pacientes[0]
    } else if (Array.isArray(patientData) && patientData.length > 0) {
      patient = patientData[0]
    } else {
      patient = patientData
    }

    const patientId = patient.paciente_id || patient.Id || patient.id || ''
    const patientFirstName = (patient.Nombres || patient.nombres || '').trim()
    const patientLastName = (patient.Apellido || patient.apellido || '').trim()
    const patientName = `${patientFirstName} ${patientLastName}`.trim()
    const patientDNI = (patient.Nrodoc || patient.dni || dni).toString()
    const patientEmailRaw = (patient.Mail || patient.mail || patient.Email || patient.email || '').trim()
    const patientEmail = patientEmailRaw === '-' || patientEmailRaw === 'NO USA' ? '' : patientEmailRaw
    const patientCelular = (patient.Celular || patient.celular || patient.Telefono || patient.telefono || '').trim()
    const obraSocialId = (patient.Deudor_Id || patient.deudor_id || '').toString().trim()
    const obraSocialNombre = (patient.Deudor_Nombre || patient.deudor_nombre || '').toString().trim()

    const result = await initializeExistingPatientFlow(
      sessionId,
      patientId,
      patientName,
      patientDNI,
      patientEmail || undefined,
      clientId,
      {
        patientFirstName,
        patientLastName,
        obraSocialId,
        obraSocialNombre,
        // Ver nota extensa en widget-chat-flow.ts / existing-patient-flow-integration.ts:
        // acá `sessionId` es anónimo (web_...), no un teléfono real.
        patientCelular: patientCelular || undefined,
      },
      escalationPhoneNumber,
      userMessage
    )

    return await finalizeExistingPatient(sessionId, result, searchOptionsConfig)
  } catch (error) {
    logger.error('Error procesando mensaje del widget de formulario', error as Error)
    return infoStep('Ocurrió un error inesperado. Por favor, recargá la página e intentá nuevamente.', false, 'error')
  }
}

// ─── Finalización por tipo de paciente ──────────────────────────────────────

async function finalizeNewPatient(
  sessionId: string,
  result: NewPatientResult,
  searchOptionsConfig?: SearchOptionsConfig
): Promise<FormWidgetStep> {
  if (result.action === 'back_to_main_menu') return dniStep()
  if (result.action === 'turno_reservado') {
    return infoStep(result.message || '¡Tu turno fue solicitado con éxito!', true, 'completed')
  }
  if (result.action === 'obra_social_no_permite_turnos_online') {
    return infoStep(result.message || FEATURE_DISABLED_MESSAGE, false, 'error')
  }
  if (result.shouldCallOpenAI && !result.message) {
    return infoStep(FEATURE_DISABLED_MESSAGE, false, 'error')
  }

  const snap = await getNewPatientFlowSnapshot(sessionId)
  if (!snap) {
    // Estado eliminado (ej: reserva cancelada/abandonada) — no hay más pasos.
    return infoStep(result.message || 'La conversación fue cancelada.', false, 'abandoned')
  }
  return buildNewPatientStep(snap, searchOptionsConfig, result.message)
}

async function finalizeExistingPatient(
  sessionId: string,
  result: ExistingPatientResult,
  searchOptionsConfig?: SearchOptionsConfig
): Promise<FormWidgetStep> {
  if (result.action === 'back_to_main_menu') return dniStep()
  if (result.action === 'turno_reservado') {
    return infoStep(result.message || '¡Tu turno fue solicitado con éxito!', true, 'completed')
  }
  if (result.action === 'obra_social_no_permite_turnos_online') {
    return infoStep(result.message || FEATURE_DISABLED_MESSAGE, false, 'error')
  }
  if (result.shouldCallOpenAI && !result.message) {
    return infoStep(FEATURE_DISABLED_MESSAGE, false, 'error')
  }

  const snap = await getExistingPatientFlowSnapshot(sessionId)
  if (!snap) {
    return infoStep(result.message || 'La conversación fue cancelada.', false, 'abandoned')
  }
  return buildExistingPatientStep(snap, searchOptionsConfig, result.message)
}

// ─── Construcción del paso estructurado a partir del estado ─────────────────

interface NormalizedFields {
  phase: string
  flow: FlowKind
  obraSocialOpciones?: ObraSocialOption[]
  sedesOpciones?: SedeOption[]
  profesionalesOpciones?: ProfessionalOption[]
  especialidadesOpciones?: SpecialtyOption[]
  turnosOpciones?: TurnoOption[]
  summary: FormWidgetSummary
}

function buildNewPatientStep(
  state: NewPatientFlowState,
  searchOptionsConfig?: SearchOptionsConfig,
  overrideMessage?: string
): FormWidgetStep {
  const nombreCompleto = [state.nombre, state.apellido].filter(Boolean).join(' ') || undefined
  return buildStepFromNormalized(
    {
      phase: state.phase,
      flow: 'new',
      obraSocialOpciones: state.obraSocialOpciones,
      sedesOpciones: state.sedesOpciones,
      profesionalesOpciones: state.profesionalesOpciones,
      especialidadesOpciones: state.especialidadesOpciones,
      turnosOpciones: state.turnosOpciones,
      summary: {
        dni: state.dni,
        nombreCompleto,
        obraSocial: state.obraSocialNombre,
        sede: state.sedeNombre,
        turno: state.turnoSeleccionado
          ? {
              fecha: state.turnoSeleccionado.fecha,
              hora: state.turnoSeleccionado.hora,
              profesionalNombre: state.turnoSeleccionado.profesionalNombre,
              sedeNombre: state.turnoSeleccionado.sedeNombre,
            }
          : undefined,
        email: state.email,
        telefono: state.telefonoContacto,
      },
    },
    searchOptionsConfig,
    overrideMessage
  )
}

function buildExistingPatientStep(
  state: ExistingPatientFlowState,
  searchOptionsConfig?: SearchOptionsConfig,
  overrideMessage?: string
): FormWidgetStep {
  const nombreCompleto =
    [state.patientFirstName, state.patientLastName].filter(Boolean).join(' ') || state.patientName || undefined
  return buildStepFromNormalized(
    {
      phase: state.phase,
      flow: 'existing',
      // El paciente existente ya tiene obra social conocida — no hay paso de
      // selección para él (a diferencia del paciente nuevo).
      obraSocialOpciones: undefined,
      sedesOpciones: state.sedesOpciones,
      profesionalesOpciones: state.profesionalesOpciones,
      especialidadesOpciones: state.especialidadesOpciones,
      turnosOpciones: state.turnosOpciones,
      summary: {
        dni: state.patientDNI,
        nombreCompleto,
        obraSocial: state.obraSocialNombre,
        sede: state.sedeNombre,
        turno: state.turnoSeleccionado
          ? {
              fecha: state.turnoSeleccionado.fecha,
              hora: state.turnoSeleccionado.hora,
              profesionalNombre: state.turnoSeleccionado.profesionalNombre,
              sedeNombre: state.turnoSeleccionado.sedeNombre,
            }
          : undefined,
        email: state.patientEmail,
        telefono: state.patientPhone,
      },
    },
    searchOptionsConfig,
    overrideMessage
  )
}

/**
 * Traduce fase + datos normalizados a un paso estructurado. Es el corazón del
 * adaptador: acá se decide qué control HTML corresponde a cada fase del motor
 * compartido.
 */
function buildStepFromNormalized(
  fields: NormalizedFields,
  searchOptionsConfig: SearchOptionsConfig | undefined,
  overrideMessage?: string
): FormWidgetStep {
  const canGoBack = backKindForPhase(fields.phase, fields.flow) !== null
  const msg = (fallback: string) => overrideMessage || fallback

  switch (fields.phase) {
    case 'awaiting_apellido':
      return {
        phase: fields.phase,
        done: false,
        message: msg('¿Cuál es tu apellido?'),
        inputType: 'text',
        fieldLabel: 'Apellido',
        placeholder: 'Tu apellido',
        canGoBack,
      }

    case 'awaiting_nombre':
      return {
        phase: fields.phase,
        done: false,
        message: msg('¿Cuál es tu nombre?'),
        inputType: 'text',
        fieldLabel: 'Nombre',
        placeholder: 'Tu nombre',
        canGoBack,
      }

    case 'awaiting_obra_social':
      return {
        phase: fields.phase,
        done: false,
        message: msg('Contanos tu obra social o prepaga.'),
        inputType: 'text',
        fieldLabel: 'Obra social',
        placeholder: 'Ej: OSDE, Swiss Medical, PAMI, Particular',
        canGoBack,
      }

    case 'awaiting_obra_social_selection':
      return {
        phase: fields.phase,
        done: false,
        message: msg('Encontramos varias coincidencias. Elegí la tuya:'),
        inputType: 'select',
        fieldLabel: 'Obra social',
        options: (fields.obraSocialOpciones || []).map((o) => ({
          id: String(o.numero),
          label: o.nombre,
          description: o.razonSocial,
        })),
        canGoBack,
      }

    case 'awaiting_sede':
      return {
        phase: fields.phase,
        done: false,
        message: msg('¿En qué sede te gustaría atenderte?'),
        inputType: 'select',
        fieldLabel: 'Sede',
        options: (fields.sedesOpciones || []).map((s) => ({
          id: String(s.numero),
          label: s.nombre,
          description: [s.domicilio, s.localidad].filter(Boolean).join(', ') || undefined,
        })),
        canGoBack,
      }

    case 'awaiting_search_type': {
      const opts = buildSearchOptionsButtons(searchOptionsConfig)
      const labels: Record<string, string> = {
        '1': 'Un profesional en particular',
        '2': 'Por especialidad',
        '3': 'Cualquier profesional disponible',
      }
      const descriptions: Record<string, string> = {
        '1': 'Ya sé con quién quiero atenderme',
        '2': 'Quiero elegir la especialidad primero',
        '3': 'Mostrame los turnos más próximos, sin importar quién',
      }
      return {
        phase: fields.phase,
        done: false,
        message: msg('¿Cómo preferís buscar tu turno?'),
        inputType: 'search-type',
        options: opts.map((o) => ({
          id: o.id,
          label: labels[o.id] || o.title,
          description: descriptions[o.id],
        })),
        canGoBack,
      }
    }

    case 'awaiting_professional_name':
      return {
        phase: fields.phase,
        done: false,
        message: msg('Escribí el nombre o apellido del profesional.'),
        inputType: 'text',
        fieldLabel: 'Profesional',
        placeholder: 'Ej: García',
        canGoBack,
      }

    case 'awaiting_professional_selection':
      return {
        phase: fields.phase,
        done: false,
        message: msg('Encontramos estos profesionales, elegí uno:'),
        inputType: 'select',
        fieldLabel: 'Profesional',
        options: (fields.profesionalesOpciones || []).map((p) => ({
          id: String(p.numero),
          label: p.nombre,
          description: p.especialidad,
        })),
        canGoBack,
      }

    case 'awaiting_specialty_selection':
      return {
        phase: fields.phase,
        done: false,
        message: msg('Elegí una especialidad:'),
        inputType: 'select',
        fieldLabel: 'Especialidad',
        options: (fields.especialidadesOpciones || []).map((e) => ({
          id: String(e.numero),
          label: e.nombre,
        })),
        canGoBack,
      }

    case 'awaiting_turno_selection':
      return {
        phase: fields.phase,
        done: false,
        message: msg('Elegí el día y el horario que prefieras:'),
        inputType: 'turno-picker',
        turnos: (fields.turnosOpciones || []).map((t) => ({
          numero: t.numero,
          fecha: t.fecha,
          hora: t.hora,
          profesionalNombre: t.profesionalNombre,
          especialidad: t.especialidad,
          sedeNombre: t.sedeNombre,
        })),
        canGoBack,
      }

    case 'awaiting_telefono':
      return {
        phase: fields.phase,
        done: false,
        message: msg('Dejanos tu número de WhatsApp para poder avisarte novedades del turno.'),
        inputType: 'tel',
        fieldLabel: 'WhatsApp',
        placeholder: 'Ej: 1122334455',
        canGoBack,
      }

    case 'awaiting_email':
      return {
        phase: fields.phase,
        done: false,
        message: msg('¿Cuál es tu email?'),
        inputType: 'email',
        fieldLabel: 'Email',
        placeholder: 'tu@email.com',
        canGoBack,
      }

    case 'awaiting_confirmation': {
      // El texto que arma el motor compartido (buildConfirmationMessage) está
      // pensado para chat/WhatsApp (con "**DATOS DEL PACIENTE**" etc.) — para
      // el formulario usamos el `summary` estructurado en su lugar y sólo
      // mostramos el texto del motor cuando NO es ese prompt estándar (ej: un
      // error real al intentar reservar, o una respuesta no reconocida).
      const isStandardPrompt = !overrideMessage || overrideMessage.includes('DATOS DEL PACIENTE')
      return {
        phase: fields.phase,
        done: false,
        message: isStandardPrompt ? 'Revisá que tus datos sean correctos antes de confirmar la reserva.' : overrideMessage!,
        inputType: 'confirmation',
        options: [
          { id: '1', label: 'Sí, confirmar' },
          { id: '2', label: 'No, modificar' },
        ],
        summary: fields.summary,
        canGoBack,
      }
    }

    case 'awaiting_modify_selection':
      return {
        phase: fields.phase,
        done: false,
        message: msg('¿Qué dato querés modificar?'),
        inputType: 'select',
        options: [
          { id: '1', label: 'Nombre y apellido' },
          { id: '2', label: 'DNI' },
          { id: '3', label: 'Obra social' },
          { id: '4', label: 'Turno' },
        ],
        canGoBack,
      }

    case 'awaiting_modify_nombre':
    case 'awaiting_modify_nombre_2':
      return {
        phase: fields.phase,
        done: false,
        message: msg('Escribí el dato actualizado.'),
        inputType: 'text',
        canGoBack,
      }

    case 'awaiting_modify_dni':
      return {
        phase: fields.phase,
        done: false,
        message: msg('Escribí tu DNI actualizado.'),
        inputType: 'dni',
        canGoBack,
      }

    case 'awaiting_modify_obra_social':
      return {
        phase: fields.phase,
        done: false,
        message: msg('Escribí tu obra social actualizada.'),
        inputType: 'text',
        placeholder: 'Ej: OSDE, Swiss Medical, PAMI, Particular',
        canGoBack,
      }

    default:
      // Fase no contemplada explícitamente (no debería ocurrir en la práctica,
      // pero evita romper el widget si el motor agrega una fase nueva) — se
      // degrada a un input de texto libre con el mensaje que haya generado el
      // motor, igual que hace el widget de chat.
      return {
        phase: fields.phase,
        done: false,
        message: msg('Continuemos con tu turno.'),
        inputType: 'text',
        canGoBack,
      }
  }
}
