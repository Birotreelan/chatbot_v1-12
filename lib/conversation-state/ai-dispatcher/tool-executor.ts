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
import { recordDiag, DIAG } from '@/lib/diagnostics'
import { fraseDerivacion } from '@/lib/utils/escalation-contact'
import { TOOL_NAMES } from './tool-manifest'
import type { DispatcherDecision } from './dispatcher'
import type { DispatcherContext } from './context-builder'

// ============================================================================
// TIPOS
// ============================================================================

/**
 * Datos que el paciente ya dio en su primer mensaje y que no hay que volver a
 * preguntarle. `preferenciaHoraria` y `sede` se agregaron el 27/8/2026 tras
 * detectar en conversaciones reales que el bot descartaba frases como
 * "turno con el Dr. Scalise, un lunes por la mañana" y arrancaba de cero.
 */
export interface InitBookingSlots {
  profesional?: string
  especialidad?: string
  /** Texto crudo de la preferencia de día/horario, tal como lo dijo el paciente. */
  preferenciaHoraria?: string
  sede?: string
}

/**
 * Qué debe hacer whatsapp.tsx después de que el executor termine.
 */
export type ExecutorAction =
  | { type: 'send_and_return'; message: string }              // enviar mensaje y terminar
  | { type: 'init_patient_detection' }                        // iniciar detección de paciente
  | { type: 'init_existing_patient_flow'; slots?: InitBookingSlots }
  | { type: 'init_new_patient_flow'; slots?: InitBookingSlots }
  | { type: 'init_familiar_flow' }                            // reserva para un familiar → pedir DNI del familiar
  | { type: 'trigger_confirm_appointment' }                   // confirmar asistencia directa
  | { type: 'trigger_cancel_menu' }                          // mostrar menú de cancelación
  | { type: 'trigger_cancel_and_rebook' }                    // cancelar + iniciar reserva
  | { type: 'continue_active_flow' }                         // reenviar mensaje al flow activo
  | { type: 'end_conversation'; message: string }            // finalizar/abandonar: cerrar flujo + despedir
  | { type: 'derive_to_human'; motivo?: string }             // el paciente pidió hablar con una persona
  | { type: 'derive_external'; message: string }             // consulta fuera de scope: ofrecer humano u tel.
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
  /** Nombre visible de la clínica, para el saludo de la primera respuesta. */
  clinicName?: string
}

// ============================================================================
// SALUDO EN LA PRIMERA RESPUESTA DE LA CONVERSACIÓN
// ============================================================================

/**
 * 31/8/2026 — Un paciente escribió como primer mensaje "Buenas tardes quisiera
 * una receta... ¿tengo que ir a Caseros o se puede digital?" y el bot arrancó
 * en seco con "Este canal es exclusivo para la gestión de turnos médicos".
 * Correcto de contenido, pero descortés: nunca se presentó ni le devolvió el
 * saludo.
 *
 * Estas respuestas del dispatcher (derivación, consulta informativa, info
 * institucional, empática) son las únicas que pueden ser lo PRIMERO que el
 * paciente lee, porque no pasan por el saludo del flujo de detección. Por eso
 * el saludo se antepone acá y no en el envío: los demás caminos ya saludan.
 */

/** Detecta si el mensaje ya empieza saludando, para no saludar dos veces. */
const YA_SALUDA_RE = /^[\s*_]*(¡?\s*)?(hola|buen(os|as)\s|bienvenid)/i

/**
 * true si el bot todavía no dijo nada en esta conversación.
 *
 * Se deduce del historial que el contexto ya trae (formato "Paciente: ..." /
 * "Bot: ..."), así que no cuesta ninguna lectura extra a Redis. El historial
 * vive 24h: si el paciente vuelve al otro día, se lo saluda de nuevo, que es
 * exactamente lo que corresponde.
 */
function esPrimeraRespuestaDeLaConversacion(ctx: DispatcherContext): boolean {
  const historial = (ctx.conversationHistory || '').trim()
  if (!historial) return true
  return !historial.split('\n').some((linea) => linea.trimStart().startsWith('Bot:'))
}

function primerNombre(nombreCompleto?: string): string {
  if (!nombreCompleto) return ''
  const primero = nombreCompleto.trim().split(/\s+/)[0] || ''
  if (!primero) return ''
  return primero.charAt(0).toUpperCase() + primero.slice(1).toLowerCase()
}

function construirSaludo(ctx: DispatcherContext, clinicName?: string): string {
  const nombre = ctx.patient.identified ? primerNombre(ctx.patient.name) : ''
  const deClinica = clinicName ? ` de ${clinicName}` : ''
  return nombre
    ? `*¡Hola, ${nombre}!* Soy Iris, la asistente virtual${deClinica}.`
    : `*¡Hola!* Soy Iris, la asistente virtual${deClinica}.`
}

/**
 * Antepone el saludo sólo si es la primera respuesta y el mensaje no saluda ya.
 *
 * 10/9/2026: pasó a exportarse. El comentario de arriba daba por sentado que las
 * respuestas del executor eran "las únicas que pueden ser lo PRIMERO que el
 * paciente lee". No era cierto: el router primario de whatsapp.tsx contesta por
 * su cuenta —sin pasar por el executor— y también puede abrir la conversación.
 * Un paciente escribió "Confirmo asistencia pos cirugía ojo izquierdo..." como
 * primer mensaje del día y recibió una respuesta seca, sin saludo (tel.
 * 1169503625).
 */
export function conSaludoSiCorresponde(mensaje: string, ctx: DispatcherContext, deps: ExecutorDeps): string {
  if (!esPrimeraRespuestaDeLaConversacion(ctx)) return mensaje
  if (YA_SALUDA_RE.test(mensaje)) return mensaje
  return `${construirSaludo(ctx, deps.clinicName)}\n\n${mensaje}`
}

// ============================================================================
// EXECUTOR PRINCIPAL
// ============================================================================

/**
 * Flujos "por pasos": los que le hicieron al paciente una pregunta concreta y
 * están esperando un dato suyo (el número de turno de una lista, el apellido,
 * la obra social).
 *
 * Es la misma lista que `hasStepFlow` en lib/conversation-state/active-flow.ts,
 * y por el mismo motivo: dentro de estos flujos, el mensaje del paciente es un
 * dato del paso, no una intención nueva. Se excluyen a propósito
 * `patient_detection` (reconstruye su propio menú y no necesita esta guarda),
 * `decision_pendiente` y `esperando_dni` (ahí la pregunta abierta ES sobre el
 * turno, así que el dispatcher decidiendo es justamente lo que queremos).
 */
const FLUJOS_POR_PASOS = new Set(['reschedule', 'existing_patient', 'new_patient', 'booking'])

/**
 * Acciones que cambian el estado de la conversación: arrancan un flujo nuevo,
 * reinician la identificación del paciente o tocan un turno.
 *
 * Las que NO están acá (responder, derivar, continuar el flujo, despedirse)
 * solo emiten un mensaje: son inofensivas aunque el modelo se equivoque.
 */
const ACCIONES_QUE_DESVIAN: ReadonlySet<ExecutorAction['type']> = new Set([
  'init_patient_detection',
  'init_existing_patient_flow',
  'init_new_patient_flow',
  'init_familiar_flow',
  'trigger_confirm_appointment',
  'trigger_cancel_menu',
  'trigger_cancel_and_rebook',
])

/**
 * Con un flujo por pasos abierto, el dispatcher puede HABLAR pero no CONDUCIR.
 *
 * ── El caso que lo motivó (16/9/2026, tel. 1140688863) ─────────────────────
 *
 * Una paciente canceló su turno, aceptó reagendar y estaba eligiendo entre 52
 * turnos. Escribió "Si por favor. Puede ser un lunes. Martes o viernes" y el
 * dispatcher eligió `cancelar_y_solicitar_nuevo_turno` → "No encontré un turno
 * activo para cancelar" (ya lo había cancelado ella misma cinco minutos antes).
 * Más tarde escribió "Viernes 9 de octubre." y el dispatcher eligió
 * `mostrar_menu_principal` → la conversación volvió a cero y le pidió el DNI.
 *
 * En los dos casos el contexto que recibió el modelo decía, correctamente,
 * `activeFlowType: "reschedule"`. Tenía el dato y eligió igual. Por eso la
 * defensa no puede ser una regla más en el prompt: tiene que ser estructural.
 *
 * Lo que hace este veto es convertir esas decisiones en `continue_active_flow`,
 * que ya está cableado para delegar en el handler del flujo correspondiente
 * (whatsapp.tsx). El handler sabe qué hacer con un mensaje que no encaja: lo
 * vuelve a preguntar sin destruir nada — que es exactamente lo que hizo bien
 * con "Viernes 9 de octubre. Puede ser" dos minutos antes.
 *
 * NO se convierte a `passthrough`: ese camino termina en
 * `initializePatientDetection`, o sea el mismo reinicio que queremos evitar.
 */
export function vetarDesvioDeFlujoPorPasos(
  resultado: ExecutorResult,
  ctx: DispatcherContext,
): ExecutorResult {
  if (!FLUJOS_POR_PASOS.has(ctx.activeFlow.type)) return resultado
  if (!ACCIONES_QUE_DESVIAN.has(resultado.action.type)) return resultado

  return {
    action: { type: 'continue_active_flow' },
    logNote: `Veto: '${resultado.action.type}' con flujo '${ctx.activeFlow.type}' abierto — se cede al handler del flujo`,
  }
}

export async function executeDispatcherDecision(
  decision: DispatcherDecision,
  ctx: DispatcherContext,
  deps: ExecutorDeps,
): Promise<ExecutorResult> {
  const logger = createConversationLogger(deps.phoneNumber, deps.configId, 'ai-dispatcher-executor')
  const resultado = await resolverDecision(decision, ctx, deps, logger)
  const final = vetarDesvioDeFlujoPorPasos(resultado, ctx)

  if (final !== resultado) {
    logger.warn('[Executor] Decisión vetada para no romper el flujo activo', {
      tool: decision.tool,
      accionDescartada: resultado.action.type,
      flujoActivo: ctx.activeFlow.type,
      fase: ctx.activeFlow.phase,
    })
  }

  return final
}

async function resolverDecision(
  decision: DispatcherDecision,
  ctx: DispatcherContext,
  deps: ExecutorDeps,
  logger: ReturnType<typeof createConversationLogger>,
): Promise<ExecutorResult> {
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
      // Reserva para un familiar/otra persona → pedir el DNI del familiar (modo familiar).
      if (decision.args.para_familiar === true) {
        return { action: { type: 'init_familiar_flow' }, logNote: 'Dispatcher → reserva para familiar' }
      }
      const slots: InitBookingSlots = {
        profesional: decision.args.profesional_mencionado || undefined,
        especialidad: decision.args.especialidad_mencionada || undefined,
        preferenciaHoraria: decision.args.preferencia_horaria || undefined,
        sede: decision.args.sede_mencionada || undefined,
      }
      void recordDiag(deps.configId, DIAG.RESERVA_INICIADA)
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
          action: {
            type: 'send_and_return',
            message: conSaludoSiCorresponde(
              'No encontré turnos próximos en tu cuenta. Si querés agendar uno, escribime y te ayudo.',
              ctx,
              deps,
            ),
          },
          logNote: 'Dispatcher → consulta info sin turno',
        }
      }

      const aspecto = decision.args.aspecto ?? 'general'
      const message = conSaludoSiCorresponde(buildInfoResponse(turno, aspecto), ctx, deps)
      return { action: { type: 'send_and_return', message }, logNote: `Dispatcher → info turno (${aspecto})` }
    }

    // ── Responder con información institucional de la clínica ───────────────
    case TOOL_NAMES.RESPONDER_INFO_CLINICA: {
      const respuesta = decision.args.respuesta as string | undefined
      if (!respuesta) {
        // Salvaguarda: si por algún motivo el LLM llamó al tool sin texto,
        // mejor derivar que mandar un mensaje vacío.
        const message = conSaludoSiCorresponde(buildDerivacionMessage('otro', deps.escalationPhone), ctx, deps)
        return { action: { type: 'derive_external', message }, logNote: 'Dispatcher → info clínica sin respuesta, derivando' }
      }
      return {
        action: { type: 'send_and_return', message: conSaludoSiCorresponde(respuesta, ctx, deps) },
        logNote: 'Dispatcher → info institucional de la clínica',
      }
    }

    // ── Derivar consulta ─────────────────────────────────────────────────────
    // Devuelve derive_external (no send_and_return): whatsapp.tsx decide si primero
    // ofrece atención humana (si la clínica la tiene activa y en horario) o manda el teléfono.
    case TOOL_NAMES.DERIVAR_CONSULTA: {
      const tipo = decision.args.tipo ?? 'otro'
      void recordDiag(deps.configId, DIAG.DERIVACION_EXTERNA)
      const message = conSaludoSiCorresponde(buildDerivacionMessage(tipo, deps.escalationPhone), ctx, deps)
      return { action: { type: 'derive_external', message }, logNote: `Dispatcher → derivación (${tipo})` }
    }

    // ── Respuesta empática ───────────────────────────────────────────────────
    case TOOL_NAMES.RESPUESTA_EMPATICA: {
      const respuesta = decision.args.respuesta as string | undefined
      const base = respuesta || '¡Gracias por escribirnos! Si necesitás algo más, estoy acá para ayudarte.'
      return {
        action: { type: 'send_and_return', message: conSaludoSiCorresponde(base, ctx, deps) },
        logNote: 'Dispatcher → respuesta empática',
      }
    }

    // ── Solicitar atención humana ────────────────────────────────────────────
    case TOOL_NAMES.SOLICITAR_HUMANO:
      void recordDiag(deps.configId, DIAG.DERIVACION_HUMANA)
      return {
        action: { type: 'derive_to_human', motivo: (decision.args.motivo as string) || undefined },
        logNote: 'Dispatcher → derivar a atención humana',
      }

    // ── Continuar flujo activo ───────────────────────────────────────────────
    case TOOL_NAMES.CONTINUAR_FLUJO:
      return { action: { type: 'continue_active_flow' }, logNote: 'Dispatcher → continuar flujo activo' }

    // ── Finalizar / abandonar conversación ───────────────────────────────────
    case TOOL_NAMES.FINALIZAR:
      return {
        action: {
          type: 'end_conversation',
          message: (decision.args.mensaje as string) || '¡Listo! Cuando quieras retomar tu turno, escribime. ¡Que tengas un buen día!',
        },
        logNote: 'Dispatcher → finalizar conversación',
      }

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
    ? fraseDerivacion('Para esa consulta comunicate directamente con la clínica', escalationPhone)
    : `Para esa consulta comunicate directamente con la clínica.`

  if (tipo === 'medica') {
    return `Las consultas médicas deben ser respondidas por un profesional de la salud.\n\n${phoneMsg}\n\nSi necesitás gestionar un turno, escribime y te ayudo.`
  }

  return `Este canal es exclusivo para la gestión de turnos médicos.\n\n${phoneMsg}\n\nSi necesitás gestionar un turno, escribime y te ayudo.`
}
