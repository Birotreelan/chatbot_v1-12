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
 * Mensaje de confirmación cuando no hay Chatbot_Data (Chatbot_Data: false).
 * Usa la info del template (fecha en formato "DD/MM/YYYY", hora, profesional, lugar)
 * sin mencionar el nombre del paciente para evitar confusión con el apellido del médico.
 */
export function buildConfirmationMessageNoName(appointmentInfo: {
  fecha?: string
  hora?: string
  profesional?: string
  lugar?: string
}): string {
  const { fecha, hora, profesional, lugar } = appointmentInfo

  if (!fecha && !hora && !profesional) {
    return `Gracias, tu confirmación fue recibida correctamente. Si necesitás algo más, no dudes en escribirme. ${getTimeBasedGreeting()}`
  }

  // Convertir fecha "DD/MM/YYYY" → formato largo "viernes, 26 de junio de 2026"
  let fechaFormateada = fecha || ''
  if (fecha && /^\d{2}\/\d{2}\/\d{4}$/.test(fecha)) {
    const [dia, mes, anio] = fecha.split('/')
    const isoDate = `${anio}-${mes}-${dia}`
    try {
      const d = new Date(isoDate + 'T12:00:00')
      fechaFormateada = new Intl.DateTimeFormat('es-AR', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      }).format(d)
    } catch {
      fechaFormateada = fecha
    }
  }

  const partes: string[] = []
  if (fechaFormateada) partes.push(`el ${fechaFormateada}`)
  if (hora) partes.push(`a las ${hora}`)
  if (profesional) partes.push(`con ${profesional}`)
  if (lugar) partes.push(`en ${lugar}`)

  const detalle = partes.join(' ')
  return `Gracias, tu confirmación para el turno ${detalle} fue recibida correctamente. Si necesitás algo más, no dudes en escribirme. ${getTimeBasedGreeting()}`
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
2- No, mantener el turno y confirmar asistencia.`
  }

  const fechaBase = turno.fecha
  const fechaCompleta = formatFullDate(fechaBase)
  const sede = turno.sede

  // Agrupar todos los turnos del mismo día (el backend los cancela juntos)
  const turnosDelMismoDia = chatbotData.turnos.filter(
    (t) => t.fecha === fechaBase
  )

  if (turnosDelMismoDia.length > 1) {
    // Listar cada turno del día
    const lineas = turnosDelMismoDia
      .map((t) => `  • ${formatTime(t.hora)} con ${t.profesional}`)
      .join('\n')
    return `${nombre}, recibimos tu pedido de cancelar los ${turnosDelMismoDia.length} turnos del ${fechaCompleta} en la sede ${sede}:

${lineas}

Para evitar cancelaciones accidentales, necesitamos que confirmes tu decisión.

1- Sí, cancelar los turnos
2- No, mantener los turnos y confirmar asistencia.`
  }

  const hora = formatTime(turno.hora)
  const profesional = turno.profesional

  return `${nombre}, recibimos tu pedido de cancelar el turno del ${fechaCompleta} a las ${hora} con ${profesional} en la sede ${sede}.

Para evitar cancelaciones accidentales, necesitamos que confirmes tu decisión.

1- Sí, cancelar el turno
2- No, mantener el turno y confirmar asistencia.`
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

  const esCancelacion = accion === "cancel_appointment" || accion === "cancel_and_book_new_appointment"

  let lineasTurnos: string
  let totalOpciones: number

  if (esCancelacion) {
    // Para cancelación: agrupar turnos del mismo día en una sola opción
    // (el backend cancela todos los turnos de un día juntos)
    const grupos: Map<string, typeof chatbotData.turnos> = new Map()
    for (const turno of chatbotData.turnos) {
      const fecha = turno.fecha
      if (!grupos.has(fecha)) grupos.set(fecha, [])
      grupos.get(fecha)!.push(turno)
    }

    const opcionesGrupo: string[] = []
    let idx = 1
    for (const [fecha, turnos] of grupos) {
      const fechaCompleta = formatFullDate(fecha)
      const sede = turnos[0].sede || ""
      if (turnos.length === 1) {
        const hora = formatTime(turnos[0].hora)
        const profesional = turnos[0].profesional || ""
        opcionesGrupo.push(`${idx}- ${fechaCompleta} a las ${hora} con ${profesional}${sede ? ` (${sede})` : ""}`)
      } else {
        const horas = turnos.map((t) => formatTime(t.hora)).join(' y ')
        opcionesGrupo.push(`${idx}- ${fechaCompleta} a las ${horas}${sede ? ` (${sede})` : ""} — *se cancelan juntos*`)
      }
      idx++
    }

    lineasTurnos = opcionesGrupo.join("\n")
    totalOpciones = grupos.size
  } else {
    // Para confirmación: mostrar individualmente
    lineasTurnos = chatbotData.turnos
      .map((turno, i) => {
        const fechaCompleta = formatFullDate(turno.fecha)
        const hora = formatTime(turno.hora)
        const profesional = turno.profesional || ""
        const sede = turno.sede || ""
        return `${i + 1}- ${fechaCompleta} a las ${hora} con ${profesional}${sede ? ` (${sede})` : ""}`
      })
      .join("\n")
    totalOpciones = chatbotData.turnos.length
  }

  // Para cancelación ofrecemos también "cancelar todos" como última opción
  const opcionCancelarTodos = esCancelacion
    ? `\n${totalOpciones + 1}- Cancelar todos los turnos agendados.`
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
 *
 * @param includeRescheduleOffer Cuando es false (p.ej. el paciente eligió
 *   "Cancelar y solicitar uno nuevo"), se omite el menú de reagendamiento y se
 *   muestra una transición directa al flujo de reserva de un turno nuevo.
 */
export function buildCancellationSuccessMessage(
  chatbotData: ChatbotData,
  turnoIndex: number = 0,
  includeRescheduleOffer: boolean = true
): string {
  const nombre = formatPatientName(chatbotData)
  const turno = chatbotData.turnos[turnoIndex]
  
  // Verificar si el turno admite reagendamiento
  const admiteReagendamiento = turno?.admite_reagendamiento !== false
  
  let message = `Gracias, ${nombre}. La cancelación fue procesada correctamente.`
  
  // El paciente ya pidió "cancelar y solicitar uno nuevo": no ofrecer el menú de
  // reagendamiento, sino transicionar directamente al flujo de reserva (selección de sede).
  if (!includeRescheduleOffer) {
    message += ` Te ayudaré a agendar un nuevo turno.`
    return message
  }
  
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
