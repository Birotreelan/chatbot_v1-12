/**
 * AI Dispatcher — Tool Executor (Sprint 60)
 *
 * Mapea cada decisión del LLM al handler determinístico correcto.
 * Es el "switch board" entre la inteligencia del dispatcher y el código real.
 *
 * Cada case recibe:
 *   - La decisión tipada del dispatcher (tool + args)
 *   - El contexto del paciente (DispatcherContext)
 *   - El ExecutorDeps: referencias a funciones de whatsapp.tsx para enviar
 *     respuestas y iniciar flujos sin acoplamiento circular.
 *
 * Retorna ExecutorResult para que whatsapp.tsx decida qué hacer a continuación.
 */

import { createConversationLogger } from '../logger'
import { TOOL_NAMES } from './tool-manifest'
import type { DispatcherDecision } from './dispatcher'
import type { DispatcherContext } from './context-builder'

// ============================================================================
// TIPOS
// ============================================================================

/**
 * Qué debe hacer whatsapp.tsx después de que el executor termine.
 */
export type ExecutorAction =
  | { type: 'send_and_return'; message: string }              // enviar mensaje y terminar
  | { type: 'init_patient_detection' }                        // iniciar detección de paciente
  | { type: 'init_existing_patient_flow'; slots?: { profesional?: string; especialidad?: string } }
  | { type: 'init_new_patient_flow'; slots?: { profesional?: string; especialidad?: string } }
  | { type: 'trigger_confirm_appointment' }                   // confirmar asistencia directa
  | { type: 'trigger_cancel_menu' }                          // mostrar menú de cancelación
  | { type: 'trigger_cancel_and_rebook' }                    // cancelar + iniciar reserva
  | { type: 'continue_active_flow' }                         // reenviar mensaje al flow activo
  | { type: 'passthrough' }                                  // ceder al enqueue/OpenAI normal

export interface ExecutorResult {
  action: ExecutorAction
  logNote?: string
}

/**
 * Dependencias inyectadas desde whatsapp.tsx para que el executor pueda
 * consultar estado sin imports circulares.
 */
export interface ExecutorDeps {
  phoneNumber: string
  configId: string
  clienteId: string
  escalationPhone?: string
}

// ============================================================================
// EXECUTOR PRINCIPAL
// ============================================================================

export async function executeDispatcherDecision(
  decision: DispatcherDecision,
  ctx: DispatcherContext,
  deps: ExecutorDeps,
): Promise<ExecutorResult> {
  const logger = createConversationLogger(deps.phoneNumber, deps.configId, 'ai-dispatcher-executor')

  logger.info('[Executor] Ejecutando tool', { tool: decision.tool, args: decision.args })

  switch (decision.tool) {

    // ── Menú principal ───────────────────────────────────────────────────────
    case TOOL_NAMES.MOSTRAR_MENU:
      return { action: { type: 'init_patient_detection' }, logNote: 'Dispatcher → menú principal' }

    // ── Confirmar asistencia ─────────────────────────────────────────────────
    case TOOL_NAMES.CONFIRMAR_ASISTENCIA:
      return { action: { type: 'trigger_confirm_appointment' }, logNote: 'Dispatcher → confirmar asistencia' }

    // ── Cancelar turno ───────────────────────────────────────────────────────
    case TOOL_NAMES.CANCELAR_TURNO:
      return { action: { type: 'trigger_cancel_menu' }, logNote: 'Dispatcher → menú cancelación' }

    // ── Cancelar y solicitar nuevo ───────────────────────────────────────────
    case TOOL_NAMES.CANCELAR_Y_REAGENDAR:
      return { action: { type: 'trigger_cancel_and_rebook' }, logNote: 'Dispatcher → cancelar y reagendar' }

    // ── Iniciar reserva de turno ─────────────────────────────────────────────
    case TOOL_NAMES.INICIAR_RESERVA: {
      const slots = {
        profesional: decision.args.profesional_mencionado || undefined,
        especialidad: decision.args.especialidad_mencionada || undefined,
      }
      // Si el paciente está identificado, usar flujo de paciente existente
      // Si no, usar flujo de nuevo paciente (pedirá DNI)
      if (ctx.patient.identified) {
        return {
          action: { type: 'init_existing_patient_flow', slots },
          logNote: `Dispatcher → reserva existente${slots.profesional ? ` (prof: ${slots.profesional})` : ''}`,
        }
      }
      return {
        action: { type: 'init_new_patient_flow', slots },
        logNote: 'Dispatcher → reserva nuevo paciente',
      }
    }

    // ── Consulta informativa ─────────────────────────────────────────────────
    case TOOL_NAMES.CONSULTA_INFORMATIVA: {
      const turno = ctx.turnos[0]
      if (!turno) {
        return {
          action: { type: 'send_and_return', message: 'No encontré turnos próximos en tu cuenta. Si querés agendar uno, escribime y te ayudo.' },
          logNote: 'Dispatcher → consulta info sin turno',
        }
      }

      const aspecto = decision.args.aspecto ?? 'general'
      const message = buildInfoResponse(turno, aspecto)
      return { action: { type: 'send_and_return', message }, logNote: `Dispatcher → info turno (${aspecto})` }
    }

    // ── Derivar consulta ─────────────────────────────────────────────────────
    case TOOL_NAMES.DERIVAR_CONSULTA: {
      const tipo = decision.args.tipo ?? 'otro'
      const message = buildDerivacionMessage(tipo, deps.escalationPhone)
      return { action: { type: 'send_and_return', message }, logNote: `Dispatcher → derivación (${tipo})` }
    }

    // ── Respuesta empática ───────────────────────────────────────────────────
    case TOOL_NAMES.RESPUESTA_EMPATICA: {
      const respuesta = decision.args.respuesta as string | undefined
      const message = respuesta || '¡Gracias por escribirnos! Si necesitás algo más, estoy acá para ayudarte.'
      return { action: { type: 'send_and_return', message }, logNote: 'Dispatcher → respuesta empática' }
    }

    // ── Continuar flujo activo ───────────────────────────────────────────────
    case TOOL_NAMES.CONTINUAR_FLUJO:
      return { action: { type: 'continue_active_flow' }, logNote: 'Dispatcher → continuar flujo activo' }

    // ── Fallback de seguridad ────────────────────────────────────────────────
    default:
      logger.warn('[Executor] Tool no reconocido, cediendo al flujo normal', { tool: decision.tool })
      return { action: { type: 'passthrough' } }
  }
}

// ============================================================================
// BUILDERS DE RESPUESTA
// ============================================================================

function buildInfoResponse(
  turno: { fecha: string; hora: string; profesional: string; sede: string },
  aspecto: string
): string {
  switch (aspecto) {
    case 'hora':
      return `Tu turno es a las *${turno.hora || 'hora no disponible'}* el ${turno.fecha}.\n\n¿Necesitás algo más?`
    case 'fecha':
      return `Tu turno es el *${turno.fecha || 'fecha no disponible'}* a las ${turno.hora}.\n\n¿Necesitás algo más?`
    case 'profesional':
      return `Tu turno es con *${turno.profesional || 'el profesional asignado'}*.\n\n¿Necesitás algo más?`
    case 'sede':
    case 'direccion':
      return `Tu turno es en *${turno.sede || 'la sede indicada'}*.\n\nPara la dirección exacta, podés consultarla en la clínica. ¿Necesitás algo más?`
    default:
      return [
        `Acá están los datos de tu turno:`,
        `📅 *Fecha:* ${turno.fecha || 'N/D'}`,
        `🕐 *Hora:* ${turno.hora || 'N/D'}`,
        `👨‍⚕️ *Profesional:* ${turno.profesional || 'N/D'}`,
        `🏥 *Sede:* ${turno.sede || 'N/D'}`,
        ``,
        `¿Necesitás algo más?`,
      ].join('\n')
  }
}

function buildDerivacionMessage(tipo: string, escalationPhone?: string): string {
  const phoneMsg = escalationPhone
    ? `Para esa consulta comunicate directamente con la clínica al *${escalationPhone}*.`
    : `Para esa consulta comunicate directamente con la clínica.`

  if (tipo === 'medica') {
    return `Las consultas médicas deben ser respondidas por un profesional de la salud.\n\n${phoneMsg}\n\nSi necesitás gestionar un turno, escribime y te ayudo.`
  }

  return `Este canal es exclusivo para la gestión de turnos médicos.\n\n${phoneMsg}\n\nSi necesitás gestionar un turno, escribime y te ayudo.`
}
