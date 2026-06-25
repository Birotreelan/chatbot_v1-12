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

function formatTurnoDescription(turno: ChatbotDataTurno | null): string {
  if (!turno) return "tu turno pendiente"
  
  const fecha = formatFullDate(turno.fecha)
  const hora = formatTime(turno.hora)
  return `el turno del ${fecha} a las ${hora} con ${turno.profesional} en la sede ${turno.sede}`
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
      const turnoDesc = formatTurnoDescription(turno)
      
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

1- Sí, cancelar el turno
2- No, mantener el turno y confirmar asistencia.`
      }
      
      // Para reagendar, similar
      if (intent === "reagendar") {
        return `${nombre}, ${ack}. Para poder hacerlo, primero necesitamos que confirmes si querés cancelar ${turnoDesc}.

1- Sí, cancelar el turno
2- No, mantener el turno y confirmar asistencia.`
      }
      
      // Para consultas de info
      if (intent === "consulta_info") {
        return `${nombre}, ${ack}. Con gusto te ayudo, pero primero necesitamos resolver la cancelación pendiente de ${turnoDesc}.

Por favor, indicame:
1- Sí, cancelar el turno
2- No, mantener el turno y confirmar asistencia.

Una vez resuelto, podré ayudarte con tu consulta.`
      }
      
      // Para saludos
      if (intent === "saludo") {
        return `¡Hola ${nombre}! Estamos en medio de confirmar una cancelación.

¿Querés cancelar ${turnoDesc}?

1- Sí, cancelar el turno
2- No, mantener el turno y confirmar asistencia.`
      }
      
      // Para quejas/frustración
      if (intent === "queja_frustracion") {
        return `${nombre}, ${ack}. Voy a ayudarte lo más rápido posible.

Solo necesito que me confirmes si querés cancelar ${turnoDesc}:

1- Sí, cancelar el turno
2- No, mantener el turno y confirmar asistencia.`
      }
      
      // Para confirmar turno (contradicción)
      if (intent === "confirmar_turno") {
        return `${nombre}, ${ack}, pero actualmente tenemos pendiente una solicitud de cancelación para ${turnoDesc}.

Si querés mantener el turno y confirmar tu asistencia, elegí la opción 2:

1- Sí, cancelar el turno
2- No, mantener el turno y confirmar asistencia.`
      }
      
      // Default para "otro" o intenciones no manejadas
      return `${nombre}, ${ack}. Para poder continuar, necesito que me indiques qué querés hacer con ${turnoDesc}:

1- Sí, cancelar el turno
2- No, mantener el turno y confirmar asistencia.`
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
