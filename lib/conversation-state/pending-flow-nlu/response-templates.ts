/**
 * Response Templates para NLU Contextual
 * 
 * Genera respuestas que reconocen la intención del usuario
 * pero lo guían a completar el flujo actual primero.
 */

import type { ChatbotData, ChatbotDataTurno } from "../../appointment-flow-state"
import type { DetectedIntent } from "./contextual-intent-handler"
import { getFirstName } from "../../utils/name-utils"

// ============================================================================
// TIPOS
// ============================================================================

export type PendingFlowType = 
  | "awaiting_cancel_confirmation"
  | "awaiting_reschedule_choice"

interface ResponseTemplates {
  buildResponse: (intent: DetectedIntent, chatbotData: ChatbotData, turnoIndex: number) => string
}

// ============================================================================
// HELPERS DE FORMATO
// ============================================================================

function formatPatientName(chatbotData: ChatbotData): string {
  const nombres = chatbotData.paciente?.nombres || ""
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

/**
 * Devuelve todos los turnos que comparten la misma fecha que el turno en
 * `turnoIndex` (el backend cancela juntos todos los turnos de un mismo día,
 * regla universal del sistema — ver caso Alberto, 11/7/2026).
 */
function getTurnosDelMismoDia(chatbotData: ChatbotData, turnoIndex: number): ChatbotDataTurno[] {
  const turno = chatbotData.turnos?.[turnoIndex]
  if (!turno) return []
  return chatbotData.turnos.filter((t) => t.fecha === turno.fecha)
}

/**
 * Describe el/los turno(s) pendientes de cancelación. Si hay más de uno en
 * la misma fecha, los agrupa y pluraliza en vez de citar solo el primero.
 */
function formatTurnoDescription(turno: ChatbotDataTurno | null, turnosDelMismoDia?: ChatbotDataTurno[]): string {
  if (!turno) return "tu turno pendiente"

  const grupo = turnosDelMismoDia && turnosDelMismoDia.length > 0 ? turnosDelMismoDia : [turno]
  const fecha = formatFullDate(turno.fecha)

  if (grupo.length > 1) {
    const lineas = grupo
      .map((t) => `  • ${formatTime(t.hora)} con ${t.profesional}`)
      .join('\n')
    return `tus ${grupo.length} turnos del ${fecha} en la sede ${turno.sede}:\n${lineas}`
  }

  const hora = formatTime(turno.hora)
  return `el turno del ${fecha} a las ${hora} con ${turno.profesional} en la sede ${turno.sede}`
}

/**
 * Pie con las opciones 1/2, singular o plural según cuántos turnos del
 * mismo día estén en juego.
 */
function getCancelConfirmationFooter(count: number): string {
  if (count > 1) {
    return `1- Sí, cancelar los turnos
2- No, mantener los turnos y confirmar asistencia.`
  }
  return `1- Sí, cancelar el turno
2- No, mantener el turno y confirmar asistencia.`
}

// ============================================================================
// TEMPLATES POR TIPO DE FLUJO
// ============================================================================

/**
 * Templates para flujo de confirmación de cancelación
 */
function buildCancelConfirmationTemplates(): ResponseTemplates {
  return {
    buildResponse: (intent: DetectedIntent, chatbotData: ChatbotData, turnoIndex: number): string => {
      const nombre = formatPatientName(chatbotData)
      const turno = chatbotData.turnos?.[turnoIndex] || null
      const turnosDelMismoDia = getTurnosDelMismoDia(chatbotData, turnoIndex)
      const turnoDesc = formatTurnoDescription(turno, turnosDelMismoDia)
      const footer = getCancelConfirmationFooter(turnosDelMismoDia.length)

      const intentAcknowledgments: Record<DetectedIntent, string> = {
        solicitar_turno: "entiendo que querés solicitar un nuevo turno",
        reagendar: "entiendo que querés reagendar tu turno",
        confirmar_turno: "entiendo que querés confirmar tu asistencia",
        consulta_info: "entiendo que tenés una consulta",
        saludo: "¡hola!",
        queja_frustracion: "lamento que estés teniendo inconvenientes",
        cancelar_turno: "entiendo que querés cancelar",
        confirmar_accion: "",
        rechazar_accion: "",
        despedida: "",
        otro: "no estoy seguro de entender tu mensaje",
      }
      
      const ack = intentAcknowledgments[intent]
      
      // Para solicitar turno nuevo, explicar que primero debe resolver el pendiente
      if (intent === "solicitar_turno") {
        return `${nombre}, ${ack}, pero para ello es necesario que primero decidas sobre ${turnoDesc}.

Necesitamos que confirmes tu decisión:

${footer}`
      }
      
      // Para reagendar, similar
      if (intent === "reagendar") {
        return `${nombre}, ${ack}. Para poder hacerlo, primero necesitamos que confirmes si querés cancelar ${turnoDesc}.

${footer}`
      }
      
      // Para consultas de info
      if (intent === "consulta_info") {
        return `${nombre}, ${ack}. Con gusto te ayudo, pero primero necesitamos resolver la cancelación pendiente de ${turnoDesc}.

Por favor, indicame:
${footer}

Una vez resuelto, podré ayudarte con tu consulta.`
      }
      
      // Para saludos
      if (intent === "saludo") {
        return `¡Hola ${nombre}! Estamos en medio de confirmar una cancelación.

¿Querés cancelar ${turnoDesc}?

${footer}`
      }
      
      // Para quejas/frustración
      if (intent === "queja_frustracion") {
        return `${nombre}, ${ack}. Voy a ayudarte lo más rápido posible.

Solo necesito que me confirmes si querés cancelar ${turnoDesc}:

${footer}`
      }
      
      // Para confirmar turno (contradicción)
      if (intent === "confirmar_turno") {
        const turnoPlural = turnosDelMismoDia.length > 1 ? "los turnos" : "el turno"
        return `${nombre}, ${ack}, pero actualmente tenemos pendiente una solicitud de cancelación para ${turnoDesc}.

Si querés mantener ${turnoPlural} y confirmar tu asistencia, elegí la opción 2:

${footer}`
      }

      // Default para "otro" o intenciones no manejadas
      return `${nombre}, ${ack}. Para poder continuar, necesito que me indiques qué querés hacer con ${turnoDesc}:

${footer}`
    }
  }
}

/**
 * Templates para flujo de elección de reagendamiento
 */
function buildRescheduleChoiceTemplates(): ResponseTemplates {
  return {
    buildResponse: (intent: DetectedIntent, chatbotData: ChatbotData, turnoIndex: number): string => {
      const nombre = formatPatientName(chatbotData)
      const turno = chatbotData.turnos?.[turnoIndex] || null
      
      const intentAcknowledgments: Record<DetectedIntent, string> = {
        solicitar_turno: "entiendo que querés un nuevo turno",
        reagendar: "entiendo que querés reagendar",
        confirmar_turno: "entiendo tu mensaje",
        consulta_info: "entiendo que tenés una consulta",
        saludo: "¡hola!",
        queja_frustracion: "lamento los inconvenientes",
        cancelar_turno: "entiendo",
        confirmar_accion: "",
        rechazar_accion: "",
        despedida: "",
        otro: "no estoy seguro de entender",
      }
      
      const ack = intentAcknowledgments[intent]
      
      // Para solicitar turno nuevo o reagendar, guiar a opción 1
      if (intent === "solicitar_turno" || intent === "reagendar") {
        return `${nombre}, ${ack}. ¡Perfecto! Para eso, elegí la opción 1 y te ayudo a buscar un nuevo horario:

1. Reagendar el turno en otra fecha y horario
2. No quiero reagendar mi turno`
      }
      
      // Para consultas de info
      if (intent === "consulta_info") {
        return `${nombre}, ${ack}. Primero, ¿querés que te ayude a reagendar tu turno?

1. Reagendar el turno en otra fecha y horario
2. No quiero reagendar mi turno

Después de resolver esto, podré ayudarte con tu consulta.`
      }
      
      // Para saludos
      if (intent === "saludo") {
        return `¡Hola ${nombre}! Tu turno fue cancelado. ¿Te gustaría reagendarlo?

1. Reagendar el turno en otra fecha y horario
2. No quiero reagendar mi turno`
      }
      
      // Para quejas/frustración
      if (intent === "queja_frustracion") {
        return `${nombre}, ${ack}. Voy a ayudarte. ¿Querés que busquemos otro horario para tu turno?

1. Reagendar el turno en otra fecha y horario
2. No quiero reagendar mi turno`
      }
      
      // Default
      return `${nombre}, ${ack}. Por favor indicame qué preferís:

1. Reagendar el turno en otra fecha y horario
2. No quiero reagendar mi turno`
    }
  }
}

// ============================================================================
// FUNCIÓN PRINCIPAL
// ============================================================================

/**
 * Obtiene los templates de respuesta según el tipo de flujo pendiente
 */
export function buildContextualResponseTemplates(flowType: PendingFlowType): ResponseTemplates {
  switch (flowType) {
    case "awaiting_cancel_confirmation":
      return buildCancelConfirmationTemplates()
    case "awaiting_reschedule_choice":
      return buildRescheduleChoiceTemplates()
    default:
      // Fallback genérico
      return buildCancelConfirmationTemplates()
  }
}
