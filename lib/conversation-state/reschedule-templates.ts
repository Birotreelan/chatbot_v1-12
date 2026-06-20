/**
 * reschedule-templates.ts
 * 
 * Templates de mensajes para el flujo deterministico de reagendamiento.
 * Se utilizan en place de los mensajes generados por OpenAI.
 */

import type { ChatbotData } from "../appointment-flow-state"
import type { TurnoDisponible, RescheduleFlowState } from "./reschedule-flow-handler"
import { getTimeBasedGreeting } from "../utils/date-utils"
import { getFirstName } from "../utils/name-utils"

// ============================================================================
// HELPERS DE FORMATO (reutilizados de direct-response-templates.ts)
// ============================================================================

function formatPatientName(nombres: string): string {
  return getFirstName(nombres)
}

function getDayOfWeek(fechaISO: string): string {
  const dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]
  const fecha = new Date(fechaISO + "T12:00:00")
  return dias[fecha.getDay()]
}

function formatFullDate(fechaISO: string): string {
  const meses = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
  ]
  
  const fecha = new Date(fechaISO + "T12:00:00")
  const dia = getDayOfWeek(fechaISO)
  const numeroDia = fecha.getDate()
  const mes = meses[fecha.getMonth()]
  const anio = fecha.getFullYear()
  
  return `${dia}, ${numeroDia} de ${mes} de ${anio}`
}

function formatTime(hora: string): string {
  if (hora.length === 5) return hora
  return hora.substring(0, 5)
}

// ============================================================================
// TEMPLATES DE REAGENDAMIENTO
// ============================================================================

/**
 * Mensaje inicial: mostrar lista de turnos disponibles
 * Se envía cuando el usuario inicia el reagendamiento
 */
export function buildRescheduleStartMessage(
  state: RescheduleFlowState,
  turnosDisponibles: TurnoDisponible[]
): string {
  const nombre = formatPatientName(state.paciente.nombres)
  const profesional = state.turnosCancelado.profesional

  let message = `${nombre}, estos son los turnos disponibles con ${profesional}:\n\n`

  turnosDisponibles.forEach((turno, index) => {
    const fecha = turno.fecha_formateada || turno.fecha
    const hora = turno.hora_formateada || formatTime(turno.hora)
    message += `${index + 1}. ${fecha} - ${hora} hs\n`
  })

  message += `\nResponde con el número del turno que queres reservar.`

  return message
}

/**
 * Mensaje de confirmacion del turno seleccionado
 */
export function buildRescheduleConfirmationMessage(
  state: RescheduleFlowState,
  turnoSeleccionado: TurnoDisponible
): string {
  const nombre = formatPatientName(state.paciente.nombres)
  const fecha = formatFullDate(turnoSeleccionado.fecha)
  const hora = formatTime(turnoSeleccionado.hora_formateada || turnoSeleccionado.hora)
  const profesional = turnoSeleccionado.profesional
  const sede = turnoSeleccionado.sede

  return `${nombre}, confirmas este turno?

Fecha: ${fecha}
Hora: ${hora} hs
Profesional: ${profesional}
Sede: ${sede}

1. Sí, confirmar
2. No, elegir otro turno`
}

/**
 * Mensaje de exito: turno reservado exitosamente
 */
export function buildRescheduleSuccessMessage(
  state: RescheduleFlowState,
  turnoReservado: TurnoDisponible
): string {
  const nombre = formatPatientName(state.paciente.nombres)
  const fecha = formatFullDate(turnoReservado.fecha)
  const hora = formatTime(turnoReservado.hora_formateada || turnoReservado.hora)
  const profesional = turnoReservado.profesional
  const sede = turnoReservado.sede
  const direccion = turnoReservado.direccion

  return `¡Listo, ${nombre}! Tu turno fue reagendado exitosamente.

Fecha: ${fecha}
Hora: ${hora} hs
Profesional: ${profesional}
Sede: ${sede} - ${direccion}

Te esperamos! Si necesitás algo más, no dudes en escribirme.`
}

/**
 * Mensaje de error: no se pudo procesar la seleccion
 */
export function buildRescheduleSelectionErrorMessage(
  state: RescheduleFlowState,
  turnosCount: number
): string {
  const nombre = formatPatientName(state.paciente.nombres)
  const intentos = state.intentosFallidos

  if (intentos <= 1) {
    return `${nombre}, no entiendo bien tu selección. Podés responder con un número del 1 al ${turnosCount}?`
  } else {
    return `${nombre}, aún no logro entender. Podés describir mejor el turno que querés? (ejemplo: "el del miércoles" o "el de las 10")`
  }
}

/**
 * Mensaje cuando el usuario rechaza el turno seleccionado
 */
export function buildRescheduleRejectionMessage(
  state: RescheduleFlowState
): string {
  const nombre = formatPatientName(state.paciente.nombres)
  return `Perfecto, ${nombre}. Elegí otro turno de la lista anterior.`
}

/**
 * Mensaje cuando el usuario abandona el flujo
 */
export function buildRescheduleAbandonMessage(
  state: RescheduleFlowState
): string {
  const nombre = formatPatientName(state.paciente.nombres)
  return `Entendido, ${nombre}. Si cambias de idea y querés reagendar en el futuro, no dudes en escribirme.

${getTimeBasedGreeting()}`
}

/**
 * Mensaje cuando hay un error interno
 */
export function buildRescheduleErrorMessage(): string {
  return `Disculpa, hubo un error al procesar tu solicitud. Por favor, intenta nuevamente.`
}

/**
 * Mensaje para cuando no hay turnos con el mismo profesional en 60 días.
 * Ofrece menú de 3 opciones de búsqueda ampliada.
 */
export function buildNoTurnosConProfesionalMessage(
  primerNombre: string,
  profesional: string
): string {
  return `Lo siento ${primerNombre}, no encontramos turnos disponibles con ${profesional} en los próximos 60 días.\n\n¿Querés buscar turno de otra forma?\n\n1. *Médico en particular* - Si ya sabés con qué profesional querés atenderte\n2. *Por especialidad* - Para elegir una especialidad y ver los profesionales disponibles\n3. *Cualquier médico disponible* - Para ver los turnos más próximos sin importar el profesional\n\nRespondé con el *número* de la opción que prefieras.`
}

/**
 * Guarda el estado awaiting_search_type en Redis con los datos del paciente y turno cancelado
 * para que el handler pueda pasarlos a OpenAI cuando el usuario elija una opción.
 */
export async function buildNoTurnosSaveSearchTypeState(
  phone: string,
  configId: string,
  turnoData: {
    profesional_id: string
    profesional: string
    sede_id: string
  },
  pacienteData: {
    nombres: string
    apellido: string
    dni: string
    telefono: string
    obra_social_id?: string
  }
): Promise<void> {
  const { saveRescheduleState } = await import("./reschedule-flow-handler")
  await saveRescheduleState(phone, configId, {
    phase: 'awaiting_search_type',
    paciente: {
      nombres: pacienteData.nombres,
      apellido: pacienteData.apellido,
      dni: pacienteData.dni,
      telefono: pacienteData.telefono,
    },
    profesional_id: turnoData.profesional_id,
    profesional_original: turnoData.profesional,
    sede_id: turnoData.sede_id,
    obra_social_id: pacienteData.obra_social_id,
    paciente_dni: pacienteData.dni,
    turnosCancelado: {
      fecha: '',
      hora: '',
      profesional: turnoData.profesional,
    },
    turnosDisponibles: [],
    turnoSeleccionado: null,
    turnoReservado: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    intentosFallidos: 0,
  })
}

/**
 * Mensaje para fallback a OpenAI
 * Se envía cuando OpenAI necesita interpretar texto libre
 */
export function buildRescheduleOpenAIMessage(
  state: RescheduleFlowState,
  fallbackReason: string
): string {
  const nombre = formatPatientName(state.paciente.nombres)

  let message = `${nombre}, `

  switch (fallbackReason) {
    case 'interpret_turn_selection':
      message += `voy a analizar mejor tu selección. Un momento...`
      break
    case 'clarify_confirmation':
      message += `necesito estar seguro de tu confirmación. Un momento...`
      break
    default:
      message += `procesando tu mensaje...`
  }

  return message
}
