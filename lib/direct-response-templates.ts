/**
 * direct-response-templates.ts
 * 
 * Funciones para construir mensajes de respuesta directa
 * sin pasar por OpenAI, usando los datos del Chatbot_Data.
 */

import type { ChatbotData, ChatbotDataTurno } from "./appointment-flow-state"
import { getTimeBasedGreeting } from "./utils/date-utils"
import { getFirstName, formatName } from "./utils/name-utils"

// ============================================================================
// HELPERS DE FORMATO
// ============================================================================

/**
 * Formatea el nombre del paciente (capitalizado, primer nombre)
 */
function formatPatientName(chatbotData: ChatbotData): string {
  const nombres = chatbotData.paciente.nombres || ""
  return getFirstName(nombres)
}

/**
 * Formatea el nombre del profesional (capitalizado)
 */
function formatProfessionalName(turno: ChatbotDataTurno): string {
  const nombre = turno.profesional || ""
  return formatName(nombre)
}

/**
 * Convierte fecha ISO (2026-05-28) a nombre del dia de la semana
 */
function getDayOfWeek(fechaISO: string): string {
  const dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]
  const fecha = new Date(fechaISO + "T12:00:00") // Usar mediodia para evitar problemas de timezone
  return dias[fecha.getDay()]
}

/**
 * Formatea fecha completa: "jueves, 28 de mayo de 2026"
 */
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

/**
 * Formatea hora: "15:10:00" -> "15:10"
 */
function formatTime(hora: string): string {
  // Si ya viene formateada (15:10), devolverla
  if (hora.length === 5) return hora
  
  // Si viene completa (15:10:00), tomar solo HH:MM
  return hora.substring(0, 5)
}

// ============================================================================
// TEMPLATES DE RESPUESTA
// ============================================================================

/**
 * Mensaje de confirmacion exitosa de turno
 * Ejemplo: "Rosa, tu confirmacion de asistencia fue recibida correctamente. 
 *           Te esperamos el jueves, 28 de mayo de 2026 a las 15:10 con la Dra. Andrea Paucar
 *           en la sede SALUD OCULAR CALLAO (Av. Callao 710)."
 */
export function buildConfirmationMessage(
  chatbotData: ChatbotData,
  turnoIndex: number = 0
): string {
  const nombre = formatPatientName(chatbotData)
  const turno = chatbotData.turnos[turnoIndex]
  
  if (!turno) {
    // Fallback si no hay turno
    return `${nombre}, tu confirmación de asistencia fue recibida correctamente. ¡Te esperamos!`
  }
  
  const fechaCompleta = formatFullDate(turno.fecha)
  const hora = formatTime(turno.hora)
  const profesional = formatProfessionalName(turno)
  const sede = turno.sede
  const direccion = turno.direccion
  
  return `${nombre}, tu confirmación de asistencia fue recibida correctamente. Te esperamos el ${fechaCompleta} a las ${hora} con ${profesional} en la sede ${sede} (${direccion}).

Si necesitás algo más, no dudes en escribirme. ${getTimeBasedGreeting()}`
}

/**
 * Mensaje de doble confirmacion para cancelacion
 * Ejemplo: "Rosa, recibimos tu pedido de cancelar el turno del jueves, 28 de mayo de 2026 
 *           a las 15:10 con ANDREA PAUCAR en la sede SALUD OCULAR CALLAO.
 *           Para evitar cancelaciones accidentales, necesitamos que confirmes tu decision.
 *           1- Si, cancelar el turno
 *           2- No, mantener el turno"
 */
export function buildCancelDoubleConfirmMessage(
  chatbotData: ChatbotData,
  turnoIndex: number = 0
): string {
  const nombre = formatPatientName(chatbotData)
  const turno = chatbotData.turnos[turnoIndex]
  
  if (!turno) {
    return `${nombre}, recibimos tu pedido de cancelación.

Para evitar cancelaciones accidentales, necesitamos que confirmes tu decisión.

1- Sí, cancelar el turno
2- No, mantener el turno`
  }
  
  const fechaCompleta = formatFullDate(turno.fecha)
  const hora = formatTime(turno.hora)
  const profesional = turno.profesional // Mantener como viene para este mensaje
  const sede = turno.sede
  
  return `${nombre}, recibimos tu pedido de cancelar el turno del ${fechaCompleta} a las ${hora} con ${profesional} en la sede ${sede}.

Para evitar cancelaciones accidentales, necesitamos que confirmes tu decisión.

1- Sí, cancelar el turno
2- No, mantener el turno`
}

/**
 * Mensaje para que el paciente elija sobre cuál turno operar cuando tiene varios.
 * El verbo de la acción se adapta: cancelar / confirmar asistencia / cancelar y solicitar uno nuevo.
 * Ejemplo:
 *   "Ariel, tenés más de un turno agendado. ¿Cuál querés cancelar?
 *    1- miércoles, 24 de junio de 2026 a las 09:50 con LANCHUSKE NATALIA (SALUD OCULAR CALLAO)
 *    2- jueves, 25 de junio de 2026 a las 11:00 con BUSTAMANTE PIA (SALUD OCULAR CALLAO)
 *    Respondé con el número del turno."
 */
export function buildTurnoSelectionMessage(
  chatbotData: ChatbotData,
  accion: "cancel_appointment" | "confirm_appointment" | "cancel_and_book_new_appointment"
): string {
  const nombre = formatPatientName(chatbotData)

  const verbo =
    accion === "confirm_appointment"
      ? "confirmar asistencia"
      : accion === "cancel_and_book_new_appointment"
        ? "cancelar (para luego solicitar uno nuevo)"
        : "cancelar"

  const lineasTurnos = chatbotData.turnos
    .map((turno, i) => {
      const fechaCompleta = formatFullDate(turno.fecha)
      const hora = formatTime(turno.hora)
      const profesional = turno.profesional || ""
      const sede = turno.sede || ""
      return `${i + 1}- ${fechaCompleta} a las ${hora} con ${profesional}${sede ? ` (${sede})` : ""}`
    })
    .join("\n")

  // Para las acciones de cancelación ofrecemos además "cancelar todos" como última opción.
  const esCancelacion = accion === "cancel_appointment" || accion === "cancel_and_book_new_appointment"
  const opcionCancelarTodos = esCancelacion
    ? `\n${chatbotData.turnos.length + 1}- Cancelar todos los turnos agendados.`
    : ""

  return `${nombre}, tenés más de un turno agendado. ¿Cuál querés ${verbo}?

${lineasTurnos}${opcionCancelarTodos}

Respondé con el número del turno que prefieras.`
}

/**
 * Doble confirmación para cancelar TODOS los turnos del paciente.
 */
export function buildCancelAllDoubleConfirmMessage(chatbotData: ChatbotData): string {
  const nombre = formatPatientName(chatbotData)

  const lineasTurnos = chatbotData.turnos
    .map((turno, i) => {
      const fechaCompleta = formatFullDate(turno.fecha)
      const hora = formatTime(turno.hora)
      const profesional = turno.profesional || ""
      const sede = turno.sede || ""
      return `${i + 1}- ${fechaCompleta} a las ${hora} con ${profesional}${sede ? ` (${sede})` : ""}`
    })
    .join("\n")

  return `${nombre}, vas a cancelar TODOS tus turnos agendados:

${lineasTurnos}

Para evitar cancelaciones accidentales, necesitamos que confirmes tu decisión.
1- Sí, cancelar todos los turnos
2- No, mantener los turnos`
}

/**
 * Mensaje de cancelación exitosa de todos los turnos.
 */
export function buildCancelAllSuccessMessage(chatbotData: ChatbotData): string {
  const nombre = formatPatientName(chatbotData)
  return `Listo, ${nombre}. Cancelamos todos tus turnos agendados correctamente.

Si querés agendar un nuevo turno, escribime cuando quieras.`
}

/**
 * Mensaje de cancelacion exitosa con opcion de reagendamiento
 * Ejemplo: "Gracias, Rosa. La cancelacion fue procesada correctamente.
 *           Puedo ofrecerte la opcion de reagendar tu turno en otra fecha y horario.
 *           1. Reagendar el turno en otra fecha y horario.
 *           2. No quiero reagendar mi turno."
 */
export function buildCancellationSuccessMessage(
  chatbotData: ChatbotData,
  turnoIndex: number = 0
): string {
  const nombre = formatPatientName(chatbotData)
  const turno = chatbotData.turnos[turnoIndex]
  
  // Verificar si el turno admite reagendamiento
  const admiteReagendamiento = turno?.admite_reagendamiento !== false
  
  let message = `Gracias, ${nombre}. La cancelación fue procesada correctamente.`
  
  if (admiteReagendamiento) {
    message += `

Puedo ofrecerte la opción de reagendar tu turno en otra fecha y horario.

Escribí el número o el texto de la opción que prefieras:

1. Reagendar el turno en otra fecha y horario.

2. No quiero reagendar mi turno.`
  }
  
  return message
}

/**
 * Mensaje cuando el usuario decide mantener el turno
 * Ejemplo: "Perfecto, Rosa. Tu turno se mantiene vigente.
 *           Te esperamos el jueves, 28 de mayo de 2026 a las 15:10..."
 */
export function buildKeepAppointmentMessage(
  chatbotData: ChatbotData,
  turnoIndex: number = 0
): string {
  const nombre = formatPatientName(chatbotData)
  const turno = chatbotData.turnos[turnoIndex]
  
  if (!turno) {
    return `Perfecto, ${nombre}. Tu turno se mantiene vigente. ¡Te esperamos!`
  }
  
  const fechaCompleta = formatFullDate(turno.fecha)
  const hora = formatTime(turno.hora)
  const profesional = formatProfessionalName(turno)
  const sede = turno.sede
  const direccion = turno.direccion
  
  return `Perfecto, ${nombre}. Tu turno se mantiene vigente.

Te esperamos el ${fechaCompleta} a las ${hora} con ${profesional} en la sede ${sede} (${direccion}).

Si necesitás algo más, no dudes en escribirme.`
}

/**
 * Mensaje cuando el usuario no quiere reagendar despues de cancelar
 */
export function buildNoRescheduleMessage(chatbotData: ChatbotData): string {
  const nombre = formatPatientName(chatbotData)
  
  return `Entendido, ${nombre}. Si en el futuro necesitás agendar un nuevo turno, no dudes en escribirme.

${getTimeBasedGreeting()}`
}

/**
 * Mensaje cuando el usuario no quiere reagendar, sin contexto de paciente.
 * Se usa cuando el appointmentContext ya fue limpiado (Sprint 39).
 */
export function buildNoRescheduleMessageFallback(): string {
  return `Entendido. Si en el futuro necesitás agendar un nuevo turno, no dudes en escribirme.

${getTimeBasedGreeting()}`
}

/**
 * Mensaje de inicio de flujo de reagendamiento
 */
export function buildRescheduleStartMessage(chatbotData: ChatbotData): string {
  const nombre = formatPatientName(chatbotData)
  
  return `Perfecto, ${nombre}. Vamos a reagendar tu turno.

¿Con qué profesional te gustaría agendar? Podés indicarme el nombre o especialidad que buscás.`
}

/**
 * Mensaje cuando el paciente intenta confirmar un turno que ya fue cancelado
 * (el proxy devuelve NOT_FOUND o error porque la acción ya no existe)
 * Ejemplo: "Rosa, el turno del jueves, 28 de mayo de 2026 a las 15:10 con Andrea Paucar
 *           fue cancelado anteriormente. Si querés agendar un nuevo turno, podés escribirme."
 */
export function buildAlreadyCancelledMessage(
  chatbotData: ChatbotData,
  turnoIndex: number = 0
): string {
  const nombre = formatPatientName(chatbotData)
  const turno = chatbotData.turnos[turnoIndex]

  if (!turno) {
    return `${nombre}, el turno que intentás confirmar ya no está disponible, ya que fue cancelado previamente. Si necesitás agendar un nuevo turno, podés escribirme y te ayudo.`
  }

  const fechaCompleta = formatFullDate(turno.fecha)
  const hora = formatTime(turno.hora)
  const profesional = formatProfessionalName(turno)
  const sede = turno.sede

  return `${nombre}, el turno del ${fechaCompleta} a las ${hora} con ${profesional} en ${sede} ya no está disponible, ya que fue cancelado previamente.

Si querés agendar un nuevo turno, podés escribirme y te ayudo con gusto.`
}
