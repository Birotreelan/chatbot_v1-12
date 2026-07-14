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

export interface FormWidgetAlert {
  type: 'info' | 'warning' | 'error'
  message: string
}

export interface FormWidgetStep {
  phase: string
  done: boolean
  success?: boolean
  message: string
  /**
   * Aviso puntual (icono + texto corto) para mostrar ADEMÁS del `message`
   * principal — se usa sólo cuando el motor compartido tiene algo nuevo y
   * relevante que decir (ej: "esa obra social no la encontramos", "no había
   * turnos con ese profesional", "no se pudo completar la reserva"), nunca
   * para repetir en texto lo que ya se ve en `options`/`turnos`/`summary`.
   */
  alert?: FormWidgetAlert
  inputType: FormWidgetInputType
  fieldLabel?: string
  placeholder?: string
  options?: FormWidgetOption[]
  turnos?: FormWidgetTurno[]
  /**
   * Si true, el frontend debe mostrar el nombre del profesional debajo de
   * cada horario. Sólo aplica cuando la búsqueda fue "cualquier médico"
   * (`searchType === 'cualquier_medico'`) — ahí el profesional varía turno a
   * turno y el paciente necesita verlo para elegir. No se calcula contando
   * profesionales distintos en el día mostrado: un día puntual puede tener
   * casualmente un solo profesional disponible y el paciente igual necesita
   * saber quién es, porque no lo eligió de antemano.
   */
  mostrarProfesionalPorTurno?: boolean
  summary?: FormWidgetSummary
  canGoBack?: boolean
}

const DNI_MESSAGE = 'Para comenzar, ingresá tu número de DNI (sin puntos).'
const FEATURE_DISABLED_MESSAGE =
  'Este servicio no está disponible por el momento. Por favor, contactanos directamente para agendar tu turno.'

function dniStep(alertMessage?: string): FormWidgetStep {
  return {
    phase: 'awaiting_dni',
    done: false,
    message: DNI_MESSAGE,
    alert: alertMessage ? { type: 'warning', message: alertMessage } : undefined,
    inputType: 'dni',
    canGoBack: false,
  }
}

function infoStep(message: string, success: boolean, phase: string): FormWidgetStep {
  return { phase, done: true, success, message, inputType: 'info', canGoBack: false }
}

/**
 * Limpia texto crudo del motor compartido (pensado para chat/WhatsApp) antes
 * de mostrarlo como `alert`: saca el markdown tipo WhatsApp (*negrita*), la
 * pista "0. Volver al paso anterior/menú principal" (ya no aplica, hay un
 * botón "Volver" dedicado en la interfaz) y espacios/saltos de línea sobrantes.
 */
function cleanBackendText(text?: string): string {
  if (!text) return ''
  return text
    .replace(/\n+0\.\s*\*?Volver[^\n*]*\*?\s*$/i, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Decide si vale la pena mostrar el texto crudo del motor como `alert`.
 * Regla principal: si la fase NO cambió (previousPhase === newPhase), es
 * porque el motor está volviendo a pedir lo mismo — típicamente una
 * validación que falló o un error al reservar, información nueva que no está
 * en ningún lado más. Si la fase cambió, es progreso normal del flujo y ese
 * texto sólo repetiría lo que ya se ve en la interfaz (options/turnos/summary),
 * con una excepción puntual: "no encontré turnos" explica por qué se volvió a
 * pantalla de búsqueda, y sí vale la pena mostrarlo.
 */
function attachAlertIfNeeded(
  step: FormWidgetStep,
  previousPhase: string | undefined,
  rawMessage: string | undefined
): FormWidgetStep {
  const cleaned = cleanBackendText(rawMessage)
  if (!cleaned) return step

  const isRetry = previousPhase !== undefined && previousPhase === step.phase
  const mentionsNoTurnos = /no encontr(é|e) turnos/i.test(cleaned)

  if (isRetry) {
    return { ...step, alert: { type: 'warning', message: cleaned } }
  }
  if (mentionsNoTurnos) {
    return { ...step, alert: { type: 'info', message: cleaned } }
  }
  return step
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
      const prevSnap = await getNewPatientFlowSnapshot(sessionId)
      const result = await handleNewPatientMessage(
        sessionId,
        userMessage,
        clientId,
        escalationPhoneNumber,
        searchOptionsConfig
      )
      return await finalizeNewPatient(sessionId, result, searchOptionsConfig, prevSnap?.phase)
    }

    // ── Flujo de paciente existente ya activo ──────────────────────────────
    if (await isExistingPatientFlowActive(sessionId)) {
      const prevSnap = await getExistingPatientFlowSnapshot(sessionId)
      const result = await handleExistingPatientMessage(
        sessionId,
        userMessage,
        clientId,
        escalationPhoneNumber,
        searchOptionsConfig
      )
      return await finalizeExistingPatient(sessionId, result, searchOptionsConfig, prevSnap?.phase)
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
  searchOptionsConfig?: SearchOptionsConfig,
  previousPhase?: string
): Promise<FormWidgetStep> {
  if (result.action === 'back_to_main_menu') return dniStep()
  if (result.action === 'turno_reservado') {
    return infoStep(cleanBackendText(result.message) || '¡Tu turno fue solicitado con éxito!', true, 'completed')
  }
  if (result.action === 'obra_social_no_permite_turnos_online') {
    return infoStep(cleanBackendText(result.message) || FEATURE_DISABLED_MESSAGE, false, 'error')
  }
  if (result.shouldCallOpenAI && !result.message) {
    return infoStep(FEATURE_DISABLED_MESSAGE, false, 'error')
  }

  const snap = await getNewPatientFlowSnapshot(sessionId)
  if (!snap) {
    // Estado eliminado (ej: reserva cancelada/abandonada) — no hay más pasos.
    return infoStep(cleanBackendText(result.message) || 'La conversación fue cancelada.', false, 'abandoned')
  }
  const step = buildNewPatientStep(snap, searchOptionsConfig)
  return attachAlertIfNeeded(step, previousPhase, result.message)
}

async function finalizeExistingPatient(
  sessionId: string,
  result: ExistingPatientResult,
  searchOptionsConfig?: SearchOptionsConfig,
  previousPhase?: string
): Promise<FormWidgetStep> {
  if (result.action === 'back_to_main_menu') return dniStep()
  if (result.action === 'turno_reservado') {
    return infoStep(cleanBackendText(result.message) || '¡Tu turno fue solicitado con éxito!', true, 'completed')
  }
  if (result.action === 'obra_social_no_permite_turnos_online') {
    return infoStep(cleanBackendText(result.message) || FEATURE_DISABLED_MESSAGE, false, 'error')
  }
  if (result.shouldCallOpenAI && !result.message) {
    return infoStep(FEATURE_DISABLED_MESSAGE, false, 'error')
  }

  const snap = await getExistingPatientFlowSnapshot(sessionId)
  if (!snap) {
    return infoStep(cleanBackendText(result.message) || 'La conversación fue cancelada.', false, 'abandoned')
  }
  const step = buildExistingPatientStep(snap, searchOptionsConfig)
  return attachAlertIfNeeded(step, previousPhase, result.message)
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
  searchType?: 'medico_particular' | 'especialidad' | 'cualquier_medico' | 'cambiar_sede'
  summary: FormWidgetSummary
}

function buildNewPatientStep(
  state: NewPatientFlowState,
  searchOptionsConfig?: SearchOptionsConfig
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
      searchType: state.searchType,
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
    searchOptionsConfig
  )
}

function buildExistingPatientStep(
  state: ExistingPatientFlowState,
  searchOptionsConfig?: SearchOptionsConfig
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
      searchType: state.searchType,
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
    searchOptionsConfig
  )
}

/**
 * Traduce fase + datos normalizados a un paso estructurado. Es el corazón del
 * adaptador: acá se decide qué control HTML corresponde a cada fase del motor
 * compartido.
 *
 * Diseño (revisión 9/7/2026, 2da vuelta): el `message` de cada fase es SIEMPRE
 * un texto corto y fijo, pensado para una interfaz (no para chat) — nunca
 * repite en prosa lo que ya se ve en `options`/`turnos`/`summary`, y nunca
 * incluye instrucciones de comandos de texto (ej. "0. Volver al paso
 * anterior": ya hay un botón "Volver" dedicado en la interfaz). El texto que
 * genera el motor compartido (pensado para WhatsApp) sólo se usa, ya
 * limpio, como `alert` puntual cuando de verdad aporta algo nuevo — eso lo
 * decide `attachAlertIfNeeded` en base a si la fase cambió o no.
 */
function buildStepFromNormalized(
  fields: NormalizedFields,
  searchOptionsConfig: SearchOptionsConfig | undefined
): FormWidgetStep {
  const canGoBack = backKindForPhase(fields.phase, fields.flow) !== null

  switch (fields.phase) {
    case 'awaiting_apellido':
      return {
        phase: fields.phase,
        done: false,
        message: '¿Cuál es tu apellido?',
        inputType: 'text',
        fieldLabel: 'Apellido',
        placeholder: 'Tu apellido',
        canGoBack,
      }

    case 'awaiting_nombre':
      return {
        phase: fields.phase,
        done: false,
        message: '¿Cuál es tu nombre?',
        inputType: 'text',
        fieldLabel: 'Nombre',
        placeholder: 'Tu nombre',
        canGoBack,
      }

    case 'awaiting_obra_social':
      return {
        phase: fields.phase,
        done: false,
        message: 'Contanos tu obra social o prepaga.',
        inputType: 'text',
        fieldLabel: 'Obra social',
        placeholder: 'Ej: OSDE, Swiss Medical, PAMI, Particular',
        canGoBack,
      }

    case 'awaiting_obra_social_selection':
      return {
        phase: fields.phase,
        done: false,
        message: 'Elegí tu obra social:',
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
        message: 'Elegí una sede:',
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
        '3': 'Cualquier oftalmólogo disponible',
      }
      const descriptions: Record<string, string> = {
        '1': 'Ya sé con quién quiero atenderme',
        '2': 'Quiero elegir la especialidad primero',
        '3': 'Ver los turnos próximos, sin profesional específico.',
      }
      return {
        phase: fields.phase,
        done: false,
        message: '¿Cómo preferís buscar tu turno?',
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
        message: 'Escribí el nombre o apellido del profesional.',
        inputType: 'text',
        fieldLabel: 'Profesional',
        placeholder: 'Ej: García',
        canGoBack,
      }

    case 'awaiting_professional_selection':
      return {
        phase: fields.phase,
        done: false,
        message: 'Elegí un profesional:',
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
        message: 'Elegí una especialidad:',
        inputType: 'select',
        fieldLabel: 'Especialidad',
        options: (fields.especialidadesOpciones || []).map((e) => ({
          id: String(e.numero),
          label: e.nombre,
        })),
        canGoBack,
      }

    case 'awaiting_turno_selection':
      // Antes se mostraba acá el texto largo del motor con el listado de
      // días/horarios (buildTurnosWindowMessage) — quedaba duplicado con el
      // datepicker + botones de horario, que ya muestran exactamente lo
      // mismo de forma visual. Ahora el mensaje es sólo el título del paso.
      return {
        phase: fields.phase,
        done: false,
        message: 'Elegí el día y el horario:',
        inputType: 'turno-picker',
        turnos: (fields.turnosOpciones || []).map((t) => ({
          numero: t.numero,
          fecha: t.fecha,
          hora: t.hora,
          profesionalNombre: t.profesionalNombre,
          especialidad: t.especialidad,
          sedeNombre: t.sedeNombre,
        })),
        mostrarProfesionalPorTurno: fields.searchType === 'cualquier_medico',
        canGoBack,
      }

    case 'awaiting_telefono':
      return {
        phase: fields.phase,
        done: false,
        message: 'Dejanos tu WhatsApp para avisarte novedades del turno.',
        inputType: 'tel',
        fieldLabel: 'WhatsApp',
        placeholder: 'Ej: 1122334455',
        canGoBack,
      }

    case 'awaiting_email':
      return {
        phase: fields.phase,
        done: false,
        message: '¿Cuál es tu email?',
        inputType: 'email',
        fieldLabel: 'Email',
        placeholder: 'tu@email.com',
        canGoBack,
      }

    case 'awaiting_confirmation':
      // El `summary` estructurado ya muestra todos los datos — el mensaje es
      // sólo la instrucción de qué hacer con ellos.
      return {
        phase: fields.phase,
        done: false,
        message: 'Revisá que tus datos sean correctos antes de confirmar la reserva.',
        inputType: 'confirmation',
        options: [
          { id: '1', label: 'Sí, confirmar' },
          { id: '2', label: 'No, modificar' },
        ],
        summary: fields.summary,
        canGoBack,
      }

    case 'awaiting_modify_selection':
      return {
        phase: fields.phase,
        done: false,
        message: '¿Qué dato querés modificar?',
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
        message: 'Escribí tu nombre y apellido actualizados.',
        inputType: 'text',
        canGoBack,
      }

    case 'awaiting_modify_dni':
      return {
        phase: fields.phase,
        done: false,
        message: 'Escribí tu DNI actualizado.',
        inputType: 'dni',
        canGoBack,
      }

    case 'awaiting_modify_obra_social':
      return {
        phase: fields.phase,
        done: false,
        message: 'Escribí tu obra social actualizada.',
        inputType: 'text',
        placeholder: 'Ej: OSDE, Swiss Medical, PAMI, Particular',
        canGoBack,
      }

    default:
      // Fase no contemplada explícitamente (no debería ocurrir en la práctica,
      // pero evita romper el widget si el motor agrega una fase nueva).
      return {
        phase: fields.phase,
        done: false,
        message: 'Continuemos con tu turno.',
        inputType: 'text',
        canGoBack,
      }
  }
}
