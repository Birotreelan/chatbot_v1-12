/**
 * direct-response-templates.ts
 * 
 * Funciones para construir mensajes de respuesta directa
 * sin pasar por OpenAI, usando los datos del Chatbot_Data.
 */

import type { ChatbotData, ChatbotDataTurno } from "./appointment-flow-state"

// ============================================================================
// HELPERS DE FORMATO
// ============================================================================

/**
 * Formatea el nombre del paciente (capitalizado)
 */
function formatPatientName(chatbotData: ChatbotData): string {
  const nombres = chatbotData.paciente.nombres || ""
  const apellido = chatbotData.paciente.apellido || ""
  
  // Tomar solo el primer nombre
  const primerNombre = nombres.split(" ")[0]
  
  // Capitalizar: ROSA -> Rosa
  return primerNombre.charAt(0).toUpperCase() + primerNombre.slice(1).toLowerCase()
}

/**
 * Formatea el nombre del profesional (Dra./Dr. + capitalizado)
 */
function formatProfessionalName(turno: ChatbotDataTurno): string {
  const nombre = turno.profesional || ""
  
  // Capitalizar cada palabra
  const capitalized = nombre
    .split(" ")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
  
  return capitalized
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

Si necesitás algo más, no dudes en escribirme. ¡Que tengas un excelente día!`
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

¡Que tengas un excelente día!`
}

/**
 * Mensaje de inicio de flujo de reagendamiento
 */
export function buildRescheduleStartMessage(chatbotData: ChatbotData): string {
  const nombre = formatPatientName(chatbotData)
  
  return `Perfecto, ${nombre}. Vamos a reagendar tu turno.

¿Con qué profesional te gustaría agendar? Podés indicarme el nombre o especialidad que buscás.`
}
