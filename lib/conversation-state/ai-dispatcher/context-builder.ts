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
import { isNewPatientFlowActive } from '../new-patient/new-patient-flow-integration'
import { isPatientDetectionFlowActive, getIdentifiedPatient } from '../patient-detection/patient-flow-handler'
import { getBookingFlowState } from '../booking-flow-handler'

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

export interface ActiveFlowSnapshot {
  type: 'patient_detection' | 'existing_patient' | 'new_patient' | 'booking' | 'none'
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
  activeFlow: ActiveFlowSnapshot    // flujo determinístico activo (si hay)
  hasActiveFlow: boolean
  conversationHistory: string       // últimos N mensajes formateados
  rawAppointmentContext: any        // ChatbotData completo (para handlers que lo necesiten)
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

  none: 'No hay flujo activo — el paciente no está en medio de ninguna acción',
}

function describePhase(phase: string): string {
  return PHASE_DESCRIPTIONS[phase] ?? `Fase: ${phase}`
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
 */
export async function buildDispatcherContext(
  phoneNumber: string,
  configId: string,
  appointmentCtx: any,
  historyLines: string = ''
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
  ] = await Promise.all([
    getIdentifiedPatient(phoneNumber),
    isExistingPatientFlowActive(phoneNumber),
    isNewPatientFlowActive(phoneNumber, configId),
    isPatientDetectionFlowActive(phoneNumber),
    getBookingFlowState(phoneNumber, configId),
  ])

  // ── Paciente identificado ──────────────────────────────────────────────────
  const patient: PatientSnapshot = {
    identified: !!identified,
    name: identified?.patientName,
    dni: identified?.patientDNI,
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

  // ── Flujo activo ───────────────────────────────────────────────────────────
  // Prioridad: existing_patient > new_patient > patient_detection > booking
  let activeFlow: ActiveFlowSnapshot = {
    type: 'none',
    phase: 'none',
    description: describePhase('none'),
  }

  if (existingActive) {
    // Solo leemos el estado detallado si el flujo está activo (evitar read innecesario)
    const existingState = await getExistingPatientState(phoneNumber)
    const phase = existingState?.phase ?? 'unknown'
    activeFlow = {
      type: 'existing_patient',
      phase,
      description: describePhase(phase),
    }
  } else if (newActive) {
    activeFlow = {
      type: 'new_patient',
      phase: 'in_progress',
      description: 'El paciente está en el flujo de registro como paciente nuevo',
    }
  } else if (detectionActive) {
    activeFlow = {
      type: 'patient_detection',
      phase: 'detecting',
      description: 'Se está identificando al paciente y mostrando el menú inicial',
    }
  } else if (bookingState?.step) {
    activeFlow = {
      type: 'booking',
      phase: bookingState.step,
      description: describePhase(bookingState.step),
    }
  }

  return {
    patient,
    turnos,
    activeFlow,
    hasActiveFlow: activeFlow.type !== 'none',
    conversationHistory: historyLines,
    rawAppointmentContext: appointmentCtx,
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

  // Flujo activo
  lines.push(`ESTADO DEL FLUJO: ${ctx.activeFlow.description}`)
  if (ctx.hasActiveFlow) {
    lines.push(`ACCIÓN PENDIENTE: El paciente está en medio de un proceso — continuarlo si el mensaje encaja, o iniciar uno nuevo si cambió de intención.`)
  }

  // Historial
  if (ctx.conversationHistory) {
    lines.push(`\nHISTORIAL RECIENTE:\n${ctx.conversationHistory}`)
  }

  return lines.join('\n')
}
