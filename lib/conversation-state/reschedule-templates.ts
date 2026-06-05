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
