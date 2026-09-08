/**
 * AI Dispatcher — Context Builder (Sprint 60)
 *
 * Consolida en un objeto tipado toda la información disponible sobre el
 * paciente, sus turnos y el estado activo de los flujos determinísticos.
 *
 * Este snapshot es la "foto" que el dispatcher pasa al LLM para que entienda
 * qué puede hacer y en qué contexto está el usuario.
 */

import { getRedisClient } from '@/lib/redis'
import { getExistingPatientState } from '../existing-patient/existing-patient-flow-handler'
import { isExistingPatientFlowActive } from '../existing-patient/existing-patient-flow-integration'
import { isNewPatientFlowActive, getNewPatientState } from '../new-patient/new-patient-flow-integration'
import {
  isPatientDetectionFlowActive,
  getIdentifiedPatient,
  getPatientDetectionState,
} from '../patient-detection/patient-flow-handler'
import { getBookingFlowState } from '../booking-flow-handler'
import { getRescheduleState } from '../reschedule-flow-handler'
import { getFlowState, getStepPrompt } from '@/lib/appointment-flow-state'
import { getDNIAwaitingState } from '../dni-handler'
import { getClinicInfo } from '@/lib/db'
import { formatClinicInfoForLLM } from '@/lib/clinic-info/context'
import { isWithinTemplateWindow } from '@/lib/appointment-stats'
import type { ClinicInfo } from '@/lib/types'

// ============================================================================
// TIPOS
// ============================================================================

export interface TurnoSnapshot {
  fecha: string
  hora: string
  profesional: string
  sede: string
  estado: string   // "Confirmado" | "No confirmado" | "Pendiente de aprobación"
}

/**
 * Turno de CIRUGÍA. Tiene forma propia — no es un turno médico con otros valores
 * (verificado el 8/9/2026 contra la respuesta real de get_paciente): no trae
 * `profesional` ni `sede`, sino `cirujano`, `quirofano`, `cirugia_nombre` y `ojo`.
 *
 * DELIBERADAMENTE NO incluye el campo `observ` de la API. Ahí la clínica guarda
 * notas clínicas internas — en el caso que originó esto: "hipertensa y diabetica
 * mov sola". Eso no puede entrar en el prompt de un modelo que después redacta
 * mensajes hacia la paciente. Se mapea campo por campo, no con spread, para que
 * agregar un campo nuevo sea una decisión explícita y no un descuido.
 */
export interface CirugiaSnapshot {
  fecha: string
  hora: string
  /** Nombre del procedimiento tal como lo registra la clínica. */
  cirugia: string
  cirujano: string
  /** "Programada", "Suspendida", etc. */
  estado: string
}

export interface ActiveFlowSnapshot {
  type:
    | 'patient_detection'
    | 'existing_patient'
    | 'new_patient'
    | 'booking'
    | 'reschedule'
    /** Decisión pendiente sobre un turno existente: doble confirmación de cancelación, elegir turno, etc. */
    | 'decision_pendiente'
    /** Se le pidió el DNI y estamos esperando que lo mande (dni-handler). */
    | 'esperando_dni'
    | 'none'
  phase: string   // fase actual dentro del flujo, o "none"
  description: string  // texto legible para el LLM: "esperando selección de sede"
}

export interface PatientSnapshot {
  identified: boolean
  name?: string
  dni?: string
  phone: string
}

/**
 * Contexto completo que se entrega al AI dispatcher.
 * Todo lo que el LLM necesita para tomar la decisión correcta.
 */
export interface DispatcherContext {
  patient: PatientSnapshot
  turnos: TurnoSnapshot[]           // turnos próximos del paciente
  /**
   * Turnos de CIRUGÍA agendados (turnos_qx). Son informativos: el paciente no
   * puede confirmarlos ni cancelarlos por este canal, los gestiona la clínica.
   *
   * 8/9/2026 (caso María García, tel. 1133550488): este dato ya venía en el
   * Chatbot_Data y ya se mostraba en el saludo inicial, pero era invisible para
   * el dispatcher. La paciente escribió "Tengo cirugía el nueve de septiembre"
   * y el sistema no tenía forma de saber si eso era cierto ni de responderle.
   */
  turnosQx: CirugiaSnapshot[]
  activeFlow: ActiveFlowSnapshot    // flujo determinístico activo (si hay)
  hasActiveFlow: boolean
  conversationHistory: string       // últimos N mensajes formateados
  rawAppointmentContext: any        // ChatbotData completo (para handlers que lo necesiten)
  clinicInfo: ClinicInfo | null     // base de conocimiento institucional cargada por la clínica (10/7/2026)
  // 19/8/2026 (caso Vicente, tel. 1139200357): true si se le envió recientemente (ventana
  // 24h) un template de recordatorio pidiéndole confirmar/cancelar y todavía no hay flujo
  // determinístico activo. Sin esta señal, formatContextForLLM decía "no hay flujo activo"
  // justo cuando el paciente SÍ tenía una pregunta explícita pendiente de responder — el
  // dispatcher clasificaba "Si mucha gracias" como simple cortesía en vez de confirmación.
  templatePendingConfirmation: boolean
  /**
   * Tipo del último template que la clínica le mandó al paciente, cuando ese
   * template es INFORMATIVO (la clínica le avisa algo) y no una pregunta:
   *
   *   - 'turno_confirmado_clinica': la clínica ACEPTÓ el turno que el paciente
   *     había solicitado. No hay nada que el paciente deba confirmar.
   *   - 'turno_cancelado_clinica': la clínica canceló el turno.
   *
   * 31/8/2026 — motivo: sin esto, el contexto le decía al modelo "se le envió un
   * recordatorio pidiéndole que confirme o cancele su asistencia" también para
   * estos templates, que no piden nada. Es información falsa en el prompt y
   * empuja al modelo a leer un simple "gracias" como una confirmación de
   * asistencia.
   */
  clinicTemplateType?: 'turno_confirmado_clinica' | 'turno_cancelado_clinica'
  /**
   * Texto EXACTO del último paso que se le envió al paciente — la pregunta que
   * está respondiendo (7/9/2026).
   *
   * Hasta acá el contexto describía la situación en abstracto ("se le pidió que
   * confirme la cancelación"), y para varios casos eso no alcanza: el modelo
   * necesita ver qué opciones se le ofrecieron y con qué palabras. El caso que
   * lo motivó es "Si mucha gracias" — sin la pregunta a la vista es cortesía;
   * con ella a la vista es, claramente, un sí.
   *
   * Sale de `getStepPrompt`, que ya guardaba este texto para poder re-mostrar el
   * paso ante una consulta intercalada. Acá se reusa ese mismo dato.
   */
  ultimaPregunta?: string
}

// ============================================================================
// DESCRIPCIÓN DE FASES (para el LLM)
// ============================================================================

const PHASE_DESCRIPTIONS: Record<string, string> = {
  // Patient detection
  awaiting_contact_intent: 'El paciente está viendo el menú inicial (solicitar turno / consulta)',
  awaiting_action_selection: 'El paciente está viendo el menú de acciones sobre su turno',
  awaiting_initial_response: 'Se le pidió el DNI al paciente para comenzar el flujo',
  awaiting_familiar_dni: 'Se le pidió el DNI de un familiar para agendar un turno',
  // 7/9/2026: esta fase existía en el flujo pero no estaba descripta acá, así que
  // el modelo no tenía forma de saber que el mensaje esperado era un DNI.
  awaiting_dni_for_disambiguation:
    'El teléfono tiene VARIOS pacientes asociados y se le pidió el DNI para saber cuál es. ' +
    'Un documento suelto, o un documento con su nombre, ES la respuesta esperada a esa pregunta',
  detecting: 'Se está identificando al paciente y mostrando el menú inicial',

  // Existing patient flow
  awaiting_sede: 'Se le está pidiendo al paciente que elija una sede',
  awaiting_search_type: 'Se le está pidiendo que elija cómo buscar turno (médico / especialidad / cualquiera)',
  awaiting_professional_name: 'Se le está pidiendo el nombre del profesional',
  awaiting_professional_selection: 'Se le está mostrando una lista de profesionales para elegir',
  awaiting_specialty_selection: 'Se le está mostrando una lista de especialidades para elegir',
  awaiting_turno_selection: 'Se le está mostrando la lista de turnos disponibles para elegir',
  awaiting_email: 'Se le está pidiendo el email para confirmar la reserva',
  awaiting_confirmation: 'Se le está mostrando el resumen de la reserva para confirmar',

  // Booking flow (legacy)
  awaiting_obra_social_selection: 'Se le está pidiendo que elija su obra social',
  awaiting_sede_selection: 'Se le está pidiendo que elija una sede (flujo legacy)',
  awaiting_search_type_selection: 'Se le está pidiendo el tipo de búsqueda (flujo legacy)',
  awaiting_profesional_selection: 'Se le está pidiendo que elija un profesional (flujo legacy)',
  awaiting_turno_confirmation: 'Se le está mostrando el turno seleccionado para confirmar (flujo legacy)',

  // Reagendamiento (lib/conversation-state/reschedule-flow-handler.ts).
  // 'awaiting_search_type' y 'awaiting_confirmation' ya están descriptos arriba
  // (el reagendamiento reutiliza esos nombres de fase) — no se repiten acá.
  showing_turns: 'Se le está mostrando la lista de turnos disponibles para reagendar su turno',
  awaiting_selection: 'Se le está pidiendo que elija uno de los turnos disponibles para reagendar',

  // Decisiones pendientes sobre un turno existente (lib/appointment-flow-state.ts).
  // 7/9/2026: este flujo era INVISIBLE para el dispatcher. Se le mostraba al
  // paciente un menú de dos opciones y, si respondía algo que no era "1" ni "2",
  // el contexto decía "no hay flujo activo" — con esa premisa el modelo mandaba
  // al menú principal y se perdía la decisión a medio tomar (caso Ives, 31/8).
  awaiting_cancel_confirmation:
    'Se le pidió que CONFIRME la cancelación de su turno (1 = sí cancelar, 2 = mantenerlo). ' +
    'Una respuesta afirmativa o negativa, aunque venga con otras palabras, responde a ESA pregunta',
  awaiting_reschedule_choice: 'Se le preguntó si quiere reagendar el turno que acaba de cancelar',
  awaiting_cancel_and_reschedule_confirm:
    'Se le mostró un menú para decidir entre confirmar la asistencia o cancelar y pedir otro turno',
  awaiting_cancel_all_confirmation: 'Se le pidió que confirme la cancelación de TODOS sus turnos',

  // Espera de DNI fuera del flujo de detección (lib/conversation-state/dni-handler.ts).
  esperando_dni:
    'Se le pidió el DNI al paciente y estamos esperando que lo mande. Un documento, ' +
    'solo o acompañado del nombre, ES la respuesta esperada',

  none: 'No hay flujo activo — el paciente no está en medio de ninguna acción',
}

function describePhase(phase: string): string {
  return PHASE_DESCRIPTIONS[phase] ?? `Fase: ${phase}`
}

/**
 * Recorta la última pregunta para meterla en el prompt sin inflar el costo.
 *
 * El problema: algunos pasos son cortos ("1- Sí, cancelar / 2- No, mantener")
 * pero otros son la lista de turnos, que pasa los 3 KB. Mandarla entera en CADA
 * mensaje multiplicaría los tokens de entrada sin necesidad.
 *
 * El recorte conserva el PRINCIPIO y el FINAL, que es donde vive lo que importa
 * para clasificar: arriba la pregunta, abajo las opciones. Lo que se descarta es
 * el medio — en la lista de turnos, las 40 filas de horarios, que no aportan
 * nada para decidir la intención.
 */
const MAX_CHARS_ULTIMA_PREGUNTA = 500

function recortarUltimaPregunta(texto: string): string {
  const limpio = texto.trim()
  if (limpio.length <= MAX_CHARS_ULTIMA_PREGUNTA) return limpio

  const mitad = Math.floor(MAX_CHARS_ULTIMA_PREGUNTA / 2)
  return `${limpio.slice(0, mitad).trimEnd()}\n[...]\n${limpio.slice(-mitad).trimStart()}`
}

// ============================================================================
// BUILDER PRINCIPAL
// ============================================================================

/**
 * Construye el DispatcherContext para un mensaje entrante.
 *
 * @param phoneNumber  Número de teléfono del usuario (E.164 normalizado)
 * @param configId     ID de configuración del cliente (para booking flow)
 * @param appointmentCtx  ChatbotData ya recuperado por whatsapp.tsx (puede ser null)
 * @param historyLines  Historial ya formateado (puede ser cadena vacía)
 * @param clienteId    cliente_id de la clínica (para leer su base de conocimiento
 *                     institucional, ver lib/clinic-info) — opcional para no
 *                     romper otros call sites que todavía no lo pasan.
 */
export async function buildDispatcherContext(
  phoneNumber: string,
  configId: string,
  appointmentCtx: any,
  historyLines: string = '',
  clienteId?: string
): Promise<DispatcherContext> {

  // ── Lecturas Redis en paralelo ────────────────────────────────────────────
  // Antes: 4-6 awaits secuenciales (~150-300ms acumulados).
  // Ahora: todas las lecturas independientes en un solo round-trip.
  const [
    identified,
    existingActive,
    newActive,
    detectionActive,
    bookingState,
    rescheduleState,
    decisionPendiente,
    esperandoDNI,
    ultimoPasoEnviado,
    clinicInfo,
    withinTemplateWindow,
  ] = await Promise.all([
    getIdentifiedPatient(phoneNumber),
    isExistingPatientFlowActive(phoneNumber),
    isNewPatientFlowActive(phoneNumber, configId),
    isPatientDetectionFlowActive(phoneNumber),
    getBookingFlowState(phoneNumber, configId),
    // 31/8/2026 (caso Ives): el reagendamiento faltaba en esta lista, así que
    // mientras el paciente elegía turno para reagendar el contexto le decía al
    // modelo "no hay flujo activo". Con esa premisa falsa, un mensaje ambiguo
    // ("5/10 15 hs.") se clasificaba como "mostrar menú principal" y la
    // conversación volvía al saludo inicial.
    getRescheduleState(phoneNumber, configId).catch(() => null),
    // 7/9/2026 (auditoría de visibilidad de flujos). Estos dos también faltaban:
    //
    //   getFlowState      → las decisiones pendientes sobre un turno existente:
    //                       la doble confirmación de cancelación, el menú de
    //                       "confirmar o cancelar y pedir otro", la selección de
    //                       cuál turno operar. Es DONDE MÁS caro sale que el
    //                       modelo crea que no pasa nada: son preguntas de sí/no
    //                       sobre cancelar un turno médico.
    //   getDNIAwaitingState → la espera de DNI fuera del flujo de detección.
    getFlowState(phoneNumber, configId).catch(() => null),
    getDNIAwaitingState(phoneNumber, configId).catch(() => null),
    // Texto literal de la última pregunta que le hicimos (ver `ultimaPregunta`).
    getStepPrompt(phoneNumber, configId).catch(() => null),
    clienteId ? getClinicInfo(clienteId) : Promise.resolve(null),
    clienteId ? isWithinTemplateWindow(clienteId, phoneNumber).catch(() => false) : Promise.resolve(false),
  ])

  // ── Paciente identificado ──────────────────────────────────────────────────
  // 8/9/2026 (caso Elsa Silva, tel. 1141898093): `identified` sale de una
  // identificación previa en Redis, que en una conversación abierta desde un
  // recordatorio no existe. Pero el titular del turno viene en el propio
  // Chatbot_Data del recordatorio — lo teníamos y no se lo mostrábamos al
  // modelo. Sin ese dato, "¿Discúlpame, para Elsa Silva?" se leyó como número
  // equivocado y se le respondió que se había confundido.
  const titularDelTurno = [appointmentCtx?.paciente?.nombres, appointmentCtx?.paciente?.apellido]
    .filter(Boolean)
    .join(' ')
    .trim()

  const patient: PatientSnapshot = {
    identified: !!identified,
    name: identified?.patientName || titularDelTurno || undefined,
    dni: identified?.patientDNI || appointmentCtx?.paciente?.dni,
    phone: phoneNumber,
  }

  // ── Turnos ─────────────────────────────────────────────────────────────────
  const turnos: TurnoSnapshot[] = []

  if (appointmentCtx?.turnos && Array.isArray(appointmentCtx.turnos)) {
    for (const t of appointmentCtx.turnos) {
      turnos.push({
        fecha:      t.fecha || t.fecha_formateada || '',
        hora:       t.hora  || t.hora_formateada  || '',
        profesional: t.profesional || '',
        sede:       t.sede || '',
        estado:     t.Estado || t.estado || 'No confirmado',
      })
    }
  } else if (appointmentCtx?.fecha) {
    // Formato plano (legacy)
    turnos.push({
      fecha:       appointmentCtx.fecha || '',
      hora:        appointmentCtx.hora  || '',
      profesional: appointmentCtx.profesional || '',
      sede:        appointmentCtx.sede || '',
      estado:      appointmentCtx.estado || 'No confirmado',
    })
  }

  // ── Turnos de cirugía (informativos) ───────────────────────────────────────
  // Mapeo explícito campo por campo: la API usa nombres propios para las
  // cirugías (cirujano/quirofano/cirugia_nombre) y trae además `observ`, con
  // notas clínicas internas que NO deben llegar al prompt. Ver CirugiaSnapshot.
  const turnosQx: CirugiaSnapshot[] = []
  if (Array.isArray(appointmentCtx?.turnos_qx)) {
    for (const qx of appointmentCtx.turnos_qx) {
      turnosQx.push({
        fecha:    qx.fecha || qx.Fecha || '',
        hora:     qx.hora  || qx.Hora  || '',
        cirugia:  qx.cirugia_nombre || qx.Cirugia_Nombre || '',
        cirujano: qx.cirujano || qx.Cirujano || '',
        estado:   qx.Estado_Texto || qx.estado_texto || '',
      })
    }
  }

  // ── Flujo activo ───────────────────────────────────────────────────────────
  //
  // Prioridad: decision_pendiente > existing_patient > new_patient >
  //            patient_detection > booking > reschedule > esperando_dni
  //
  // La decisión pendiente va PRIMERA a propósito (7/9/2026): es una pregunta
  // concreta de sí/no que acabamos de hacerle al paciente sobre un turno médico
  // ("¿confirmás que querés cancelar?"). Si hay una de esas abierta, es lo más
  // inmediato que hay en la conversación, por encima de cualquier flujo de
  // reserva que también esté a medias.
  let activeFlow: ActiveFlowSnapshot = {
    type: 'none',
    phase: 'none',
    description: describePhase('none'),
  }

  if (decisionPendiente?.type) {
    activeFlow = {
      type: 'decision_pendiente',
      phase: decisionPendiente.type,
      description: describePhase(decisionPendiente.type),
    }
  } else if (existingActive) {
    // Solo leemos el estado detallado si el flujo está activo (evitar read innecesario)
    const existingState = await getExistingPatientState(phoneNumber)
    const phase = existingState?.phase ?? 'unknown'
    activeFlow = {
      type: 'existing_patient',
      phase,
      description: describePhase(phase),
    }
  } else if (newActive) {
    // 7/9/2026 — Misma falla que tenía patient_detection: la fase estaba
    // hardcodeada en 'in_progress', así que el modelo no distinguía si le
    // acabábamos de pedir el apellido, el email, la obra social o la sede.
    // Todas esas respuestas le llegaban como "está en el flujo de registro".
    const estadoNuevo = await getNewPatientState(phoneNumber)
    const faseNuevo = estadoNuevo?.phase ?? 'in_progress'
    activeFlow = {
      type: 'new_patient',
      phase: faseNuevo,
      description:
        faseNuevo === 'in_progress'
          ? 'El paciente está en el flujo de registro como paciente nuevo'
          : `Registro de paciente nuevo — ${describePhase(faseNuevo)}`,
    }
  } else if (detectionActive) {
    // 7/9/2026 (caso Rosa Mattos, tel. 1162028924) — Acá la fase estaba HARDCODEADA
    // en 'detecting' con la descripción "mostrando el menú inicial", sin importar en
    // qué paso estuviera realmente el flujo. El dispatcher nunca se enteraba de que
    // le acabábamos de pedir el DNI al paciente.
    //
    // Consecuencia real: se le pidió el DNI, respondió "9390322 rosa mattos" — el
    // dato exacto que se le había pedido — y el modelo, creyendo que sólo se estaba
    // mostrando un menú, lo clasificó como "mostrar menú principal". Se le volvió a
    // mostrar el menú, se perdió la identificación y terminó agendando un turno como
    // "Paciente", sin nombre ni DNI.
    //
    // Leer la fase real cuesta una lectura de Redis sólo cuando el flujo está activo.
    const estadoDeteccion = await getPatientDetectionState(phoneNumber)
    const fase = estadoDeteccion?.phase ?? 'detecting'
    activeFlow = {
      type: 'patient_detection',
      phase: fase,
      description: describePhase(fase),
    }
  } else if (bookingState?.step) {
    activeFlow = {
      type: 'booking',
      phase: bookingState.step,
      description: describePhase(bookingState.step),
    }
  } else if (rescheduleState?.phase && rescheduleState.phase !== 'completed') {
    // 'completed' significa que la reserva ya se ejecutó: el estado sigue en Redis
    // hasta que expire, pero el paciente no está en medio de nada.
    activeFlow = {
      type: 'reschedule',
      phase: rescheduleState.phase,
      description: describePhase(rescheduleState.phase),
    }
  } else if (esperandoDNI) {
    // Última en la cadena: es el estado más débil (sólo dice "le pedimos el DNI"),
    // así que cualquier flujo concreto que esté abierto describe mejor la situación.
    activeFlow = {
      type: 'esperando_dni',
      phase: 'esperando_dni',
      description: describePhase('esperando_dni'),
    }
  }

  // Templates informativos de la clínica: avisan algo, no preguntan nada.
  const tipoMensaje = appointmentCtx?.tipo_mensaje
  const clinicTemplateType =
    tipoMensaje === 'turno_confirmado_clinica' || tipoMensaje === 'turno_cancelado_clinica'
      ? (tipoMensaje as 'turno_confirmado_clinica' | 'turno_cancelado_clinica')
      : undefined

  return {
    patient,
    turnos,
    turnosQx,
    activeFlow,
    hasActiveFlow: activeFlow.type !== 'none',
    conversationHistory: historyLines,
    rawAppointmentContext: appointmentCtx,
    clinicInfo,
    // Un template informativo NO deja una confirmación pendiente: la clínica ya
    // resolvió el turno. Sin esta exclusión, el contexto le pedía al modelo que
    // interpretara cualquier respuesta afirmativa como "confirmar asistencia".
    templatePendingConfirmation: withinTemplateWindow && turnos.length > 0 && !clinicTemplateType,
    clinicTemplateType,
    ultimaPregunta:
      typeof ultimoPasoEnviado === 'string' && ultimoPasoEnviado.trim()
        ? recortarUltimaPregunta(ultimoPasoEnviado)
        : undefined,
  }
}

// ============================================================================
// FORMATEADOR — texto legible para el system prompt del LLM
// ============================================================================

/**
 * Convierte el DispatcherContext en un bloque de texto para el system prompt.
 */
export function formatContextForLLM(ctx: DispatcherContext): string {
  const lines: string[] = []

  // Paciente
  if (ctx.patient.identified) {
    lines.push(`PACIENTE IDENTIFICADO: ${ctx.patient.name ?? 'Nombre desconocido'} (DNI: ${ctx.patient.dni ?? 'N/D'})`)
  } else if (ctx.patient.name) {
    // Sin identificación previa, pero el recordatorio dice a nombre de quién
    // está el turno. Sirve para reconocer cuándo alguien pregunta justamente por
    // ese nombre (caso Elsa Silva, 8/9/2026).
    lines.push(`TITULAR DEL TURNO: ${ctx.patient.name}`)
    lines.push(
      `SI EL PACIENTE PREGUNTA POR ESE NOMBRE ("¿es para ${ctx.patient.name.split(' ')[0]}?", "¿para quién es el turno?"), está verificando que el recordatorio le corresponde → responder_consulta_informativa. NO es un número equivocado.`,
    )
  } else {
    lines.push(`PACIENTE: No identificado aún`)
  }

  // Turnos
  if (ctx.turnos.length === 0) {
    lines.push(`TURNOS PRÓXIMOS: Ninguno`)
  } else {
    ctx.turnos.forEach((t, i) => {
      lines.push(`TURNO ${i + 1}: ${t.fecha} a las ${t.hora} con ${t.profesional} en ${t.sede} — Estado: ${t.estado}`)
    })
  }

  // Cirugías: informativas. Se listan aparte de los turnos médicos porque el
  // paciente NO puede gestionarlas por este canal, y confundirlas con un turno
  // normal llevaría a ofrecerle cancelar o reagendar algo que no corresponde.
  if (ctx.turnosQx.length > 0) {
    ctx.turnosQx.forEach((qx, i) => {
      const partes = [
        `CIRUGÍA ${i + 1}: ${qx.fecha}`,
        qx.hora ? ` a las ${qx.hora}` : '',
        qx.cirujano ? ` con ${qx.cirujano}` : '',
        qx.cirugia ? ` — ${qx.cirugia}` : '',
        qx.estado ? ` (${qx.estado})` : '',
      ]
      lines.push(partes.join(''))
    })
    lines.push(
      `SOBRE LAS CIRUGÍAS: son sólo informativas. Si el paciente pregunta por la fecha u hora de su cirugía, o menciona una que figura arriba, podés confirmarle esos datos con responder_consulta_informativa. Lo que NO podés es confirmarla, cancelarla ni reagendarla por este canal: para eso, derivar_consulta_externa.`,
    )
  }

  // Template informativo de la clínica (no pide nada al paciente). Va antes del
  // estado del flujo porque cambia por completo cómo hay que leer su respuesta:
  // un "gracias" acá es cortesía, no una confirmación de asistencia.
  if (ctx.clinicTemplateType === 'turno_confirmado_clinica') {
    lines.push(
      `ÚLTIMO MENSAJE DE LA CLÍNICA: se le confirmó que el turno que había solicitado FUE ACEPTADO. Es un aviso, no una pregunta: el paciente NO tiene nada que confirmar.`,
    )
    lines.push(
      `CÓMO LEER SU RESPUESTA: un agradecimiento o cortesía ("gracias", "hola buen día muchas gracias", "perfecto") es solo eso → respuesta_empatica. NO uses confirmar_asistencia_turno (no hay nada pendiente de confirmar) ni mostrar_menu_principal (no es un saludo suelto).`,
    )
  } else if (ctx.clinicTemplateType === 'turno_cancelado_clinica') {
    lines.push(
      `ÚLTIMO MENSAJE DE LA CLÍNICA: se le avisó que la clínica CANCELÓ su turno. Es un aviso, no una pregunta.`,
    )
    lines.push(
      `CÓMO LEER SU RESPUESTA: si pide otro turno → iniciar_reserva_turno. Si solo acusa recibo o agradece → respuesta_empatica. NO uses cancelar_turno (el turno ya está cancelado por la clínica).`,
    )
  }

  // Flujo activo
  if (ctx.hasActiveFlow) {
    lines.push(`ESTADO DEL FLUJO: ${ctx.activeFlow.description}`)
    lines.push(`ACCIÓN PENDIENTE: El paciente está en medio de un proceso — continuarlo si el mensaje encaja, o iniciar uno nuevo si cambió de intención.`)
  } else if (ctx.templatePendingConfirmation) {
    // 19/8/2026 (caso Vicente, tel. 1139200357): sin esto, acá se mostraba "no hay
    // flujo activo" justo cuando el paciente SÍ tenía una pregunta explícita
    // pendiente de responder (el recordatorio de turno le pidió confirmar o
    // cancelar). "Si mucha gracias" se clasificaba como cortesía suelta
    // (respuesta_empatica) en vez de confirmar_asistencia_turno.
    lines.push(`ESTADO DEL FLUJO: Se le envió recientemente un recordatorio de turno pidiéndole que confirme o cancele su asistencia. Todavía no respondió eso explícitamente.`)
    lines.push(`ACCIÓN PENDIENTE: Cualquier respuesta afirmativa, aunque sea breve o venga mezclada con cortesía ("sí, gracias", "dale, gracias", "ok, muchas gracias"), es MUY probablemente la respuesta a esa pregunta → confirmar_asistencia_turno. Una respuesta negativa ("no puedo", "no voy a poder ir") → cancelar_turno. Usá respuesta_empatica para el agradecimiento SOLO si el mensaje claramente no responde la pregunta (agradece por otra cosa, hace una pregunta nueva, etc.).`)
  } else {
    lines.push(`ESTADO DEL FLUJO: ${ctx.activeFlow.description}`)
  }

  // Última pregunta, TEXTUAL (7/9/2026).
  //
  // La descripción del flujo dice qué estamos esperando en abstracto; esto
  // muestra con qué palabras se lo preguntamos y qué opciones se le dieron.
  // Para mensajes cortos y ambiguos ("sí", "el segundo", "si mucha gracias",
  // "dale") es la diferencia entre entenderlos y no: sin la pregunta a la
  // vista, "si mucha gracias" es una cortesía; con ella, es un sí.
  //
  // Va DESPUÉS del estado del flujo y ANTES del historial a propósito: es el
  // dato más inmediato y el que más pesa para leer el mensaje entrante.
  //
  // Sólo se muestra si hay algo pendiente. El paso guardado vive 1 hora, así que
  // sin esta condición un paciente que vuelve a escribir 50 minutos después —
  // ya con otro tema — vería su mensaje interpretado como respuesta a una
  // pregunta vieja. Es el mismo riesgo que documenta clearStepState (caso
  // 26/8/2026, tel. 2215029948: se re-mostraba un mensaje terminal como si fuera
  // el paso vigente).
  if (ctx.ultimaPregunta && (ctx.hasActiveFlow || ctx.templatePendingConfirmation)) {
    lines.push('')
    lines.push(`ÚLTIMO MENSAJE QUE LE ENVIAMOS (es lo que el paciente está respondiendo):`)
    lines.push(`"""`)
    lines.push(ctx.ultimaPregunta)
    lines.push(`"""`)
    lines.push(
      `CÓMO USARLO: si el mensaje del paciente encaja como respuesta a eso — aunque sea corto, ` +
        `informal, con errores de tipeo o mezclado con cortesía — entonces está continuando ese ` +
        `paso, no empezando algo nuevo. Sólo tratalo como intención nueva si claramente cambia de tema.`,
    )
  }

  // Historial
  if (ctx.conversationHistory) {
    lines.push(`\nHISTORIAL RECIENTE:\n${ctx.conversationHistory}`)
  }

  // Base de conocimiento institucional (cargada por la clínica, ver lib/clinic-info)
  lines.push(`\n${formatClinicInfoForLLM(ctx.clinicInfo)}`)

  return lines.join('\n')
}
