/**
 * reschedule-flow-integration.ts
 * 
 * Integración del flujo de reagendamiento determinístico en whatsapp.tsx
 * Proporciona funciones para interceptar y procesar mensajes en el flujo de reagendamiento.
 */

import { sendWhatsAppMessage } from "../whatsapp-api"
import { saveConversationMessage } from "../conversations"
import { nanoid } from "nanoid"
import { updateWhatsAppStats } from "../db"
import { trackAppointmentEvent } from "../appointment-stats"
import {
  getRescheduleState,
  saveRescheduleState,
  clearRescheduleState,
  handleRescheduleMessage,
  initRescheduleFlow,
  isConfirmation,
  isAbandon,
  type RescheduleFlowState,
  type RescheduleFlowResult,
  type TurnoDisponible,
} from "./reschedule-flow-handler"
import {
  buildRescheduleStartMessage,
  buildRescheduleConfirmationMessage,
  buildRescheduleSuccessMessage,
  buildRescheduleSelectionErrorMessage,
  buildRescheduleRejectionMessage,
  buildRescheduleAbandonMessage,
  buildRescheduleErrorMessage,
  buildRescheduleOpenAIMessage,
} from "./reschedule-templates"
import type { ChatbotData } from "../appointment-flow-state"
import { getAppointmentContext, saveAppointmentContext } from "../appointment-flow-state"
import { getThreadForUser, safelyAddMessageToThread } from "../thread-manager"
import { clearPostActionContext } from "./post-action-context"

// ============================================================================
// CONSTANTES
// ============================================================================

// ============================================================================
// CONTEXT PARA ENVIOS DE MENSAJES
// ============================================================================

interface RescheduleResponseContext {
  phoneNumberId: string
  accessToken: string
  userPhoneNumber: string
  configId: string
  clienteId?: string
}

// ============================================================================
// FUNCIONES INTERNAS
// ============================================================================

/**
 * Envía un mensaje directo y lo guarda en el historial
 */
async function sendRescheduleResponse(
  ctx: RescheduleResponseContext,
  message: string
): Promise<boolean> {
  try {
    await sendWhatsAppMessage(
      ctx.phoneNumberId,
      ctx.accessToken,
      ctx.userPhoneNumber,
      message
    )

    await saveConversationMessage({
      id: nanoid(),
      role: "assistant",
      content: message,
      timestamp: new Date().toISOString(),
      phoneNumber: ctx.userPhoneNumber,
      configId: ctx.configId,
    })

    return true
  } catch (error) {
    console.error("[RESCHEDULE-INTEGRATION] Error enviando respuesta:", error)
    return false
  }
}

/**
 * Tras un reagendamiento exitoso, sincroniza TODO el contexto persistente para que
 * el turno cancelado deje de aparecer como "vigente". Sin esto, el thread de OpenAI
 * sigue sembrado con el CONTEXTO_COMPLETO_TURNO del turno original (cancelado) y, ante
 * un mensaje libre posterior, el asistente responde refiriéndose al turno cancelado.
 *
 * Acciones:
 *  1. Actualiza el appointment_context en Redis: turnos[] = [nuevo turno],
 *     tipo_mensaje = "turno_reagendado", turno_cancelado eliminado.
 *  2. Inyecta un mensaje de actualización en el thread de OpenAI para que el asistente
 *     ignore el turno cancelado y use el nuevo turno como vigente.
 *  3. Limpia el contexto post-acción (que quedó como "cancellation").
 *
 * Es best-effort: cualquier error se loguea pero no interrumpe el flujo de éxito.
 */
async function syncContextAfterReschedule(
  userPhoneNumber: string,
  configId: string,
  turno: TurnoDisponible,
  paciente: RescheduleFlowState["paciente"],
  obraSocialId?: string,
  obraSocialNombre?: string
): Promise<void> {
  // 1. Actualizar appointment_context en Redis
  try {
    const existing = await getAppointmentContext(userPhoneNumber, configId)
    const nuevoTurno = {
      fecha: turno.fecha,
      fecha_formateada: turno.fecha_formateada,
      hora: turno.hora,
      hora_formateada: turno.hora_formateada,
      profesional: turno.profesional,
      profesional_id: turno.profesional_id,
      sede: turno.sede,
      direccion: turno.direccion,
      agenda_id: turno.agenda_id,
      admite_reagendamiento: true,
      tipo: "consulta",
    }

    const updated: ChatbotData = {
      ...(existing || {}),
      paciente: existing?.paciente || {
        nombres: paciente.nombres,
        apellido: paciente.apellido,
        dni: paciente.dni,
        telefono: paciente.telefono,
        ...(obraSocialId ? { obra_social_id: obraSocialId } : {}),
        ...(obraSocialNombre ? { obra_social_nombre: obraSocialNombre } : {}),
      },
      turnos: [nuevoTurno],
      cantidad_turnos: 1,
      tipo_mensaje: "turno_reagendado",
    } as ChatbotData

    // Eliminar el snapshot del turno cancelado para que no se reutilice
    if ("turno_cancelado" in updated) {
      delete (updated as { turno_cancelado?: unknown }).turno_cancelado
    }

    await saveAppointmentContext(userPhoneNumber, configId, updated)
    console.log(`[RESCHEDULE-INTEGRATION] appointment_context actualizado con el turno reagendado`)
  } catch (err) {
    console.error("[RESCHEDULE-INTEGRATION] Error actualizando appointment_context tras reagendar:", err)
  }

  // 2. Actualizar el thread de OpenAI para que ignore el turno cancelado
  try {
    const threadData = await getThreadForUser(userPhoneNumber, configId)
    const threadId = threadData?.thread_id
    if (threadId) {
      const updateMessage = `[SISTEMA_ACTUALIZACION_TURNO]
El turno mencionado anteriormente fue CANCELADO y REEMPLAZADO mediante un reagendamiento exitoso.
IMPORTANTE: Ignorá por completo el turno cancelado del contexto previo. El único turno VIGENTE del paciente es el siguiente:

[CONTEXTO_COMPLETO_TURNO]
Paciente_Nombres: ${paciente.nombres}
Paciente_Apellido: ${paciente.apellido}
Paciente_DNI: ${paciente.dni}
Paciente_Telefono: ${paciente.telefono}${obraSocialNombre ? `\nPaciente_Obra_Social: ${obraSocialNombre}` : ""}

Cantidad_Turnos: 1

Turno_1:
  - Fecha_Formateada: ${turno.fecha_formateada}
  - Hora_Formateada: ${turno.hora_formateada}
  - Profesional: ${turno.profesional}
  - Sede: ${turno.sede}
  - Dirección: ${turno.direccion}
  - Agenda_ID: ${turno.agenda_id}

Tipo_Mensaje: turno_reagendado
[/CONTEXTO_COMPLETO_TURNO]
[/SISTEMA_ACTUALIZACION_TURNO]`

      await safelyAddMessageToThread(threadId, { role: "user", content: updateMessage })
      console.log(`[RESCHEDULE-INTEGRATION] Thread de OpenAI actualizado con el turno reagendado`)
    }
  } catch (err) {
    console.error("[RESCHEDULE-INTEGRATION] Error actualizando thread de OpenAI tras reagendar:", err)
  }

  // 3. Limpiar contexto post-acción (quedó como "cancellation")
  try {
    await clearPostActionContext(userPhoneNumber, configId)
  } catch (err) {
    console.error("[RESCHEDULE-INTEGRATION] Error limpiando post-action context tras reagendar:", err)
  }
}

// ============================================================================
// HANDLER PRINCIPAL - Se llama desde whatsapp.tsx
// ============================================================================

export interface RescheduleProcessResult {
  handled: boolean // true si se procesó con flujo determinístico
  fallbackToOpenAI: boolean // true si necesita OpenAI
  message?: string // mensaje a enviar al usuario
  fallbackContext?: any // contexto para OpenAI
}

/**
 * Inicia el flujo de reagendamiento con turnos disponibles
 * Se llama cuando el usuario elige "1. Reagendar" después de cancelar
 */
export async function startRescheduleFlow(
  chatbotData: ChatbotData,
  turnosDisponibles: TurnoDisponible[],
  phoneNumberId: string,
  accessToken: string,
  userPhoneNumber: string,
  configId: string,
  clienteId?: string
): Promise<RescheduleProcessResult> {
  console.log(`[RESCHEDULE-INTEGRATION] Iniciando flujo de reagendamiento`)

  const ctx: RescheduleResponseContext = {
    phoneNumberId,
    accessToken,
    userPhoneNumber,
    configId,
    clienteId,
  }

  // Inicializar estado del flujo
  const initResult = await initRescheduleFlow(
    chatbotData,
    turnosDisponibles,
    userPhoneNumber,
    configId
  )

  if (initResult.type === 'error') {
    console.warn(`[RESCHEDULE-INTEGRATION] Error iniciando flujo:`, initResult.message)
    return {
      handled: false,
      fallbackToOpenAI: false,
      message: initResult.message,
    }
  }

  if (!initResult.state) {
    return {
      handled: false,
      fallbackToOpenAI: false,
      message: buildRescheduleErrorMessage(),
    }
  }

  // Construir y enviar mensaje con lista de turnos
  const turnosMsg = buildRescheduleStartMessage(initResult.state, turnosDisponibles)
  await sendRescheduleResponse(ctx, turnosMsg)

  // Trackear inicio
  if (clienteId) {
    await trackAppointmentEvent({
      clienteId,
      phoneNumber: userPhoneNumber,
      eventType: "reschedule_started",
      timestamp: new Date().toISOString(),
    })
  }

  return {
    handled: true,
    fallbackToOpenAI: false,
  }
}

/**
 * Procesa un mensaje durante el flujo de reagendamiento
 * Se llama para cada mensaje del usuario mientras está en el flujo
 */
export async function processRescheduleMessage(
  userMessage: string,
  phoneNumberId: string,
  accessToken: string,
  userPhoneNumber: string,
  configId: string,
  clienteId?: string
): Promise<RescheduleProcessResult> {
  console.log(`[RESCHEDULE-INTEGRATION] Procesando mensaje en flujo de reagendamiento`)

  const ctx: RescheduleResponseContext = {
    phoneNumberId,
    accessToken,
    userPhoneNumber,
    configId,
    clienteId,
  }

  // Obtener estado actual del flujo
  const state = await getRescheduleState(userPhoneNumber, configId)

  if (!state) {
    console.warn(`[RESCHEDULE-INTEGRATION] No hay estado de flujo activo`)
    return {
      handled: false,
      fallbackToOpenAI: false,
    }
  }

  // Procesar el mensaje con el handler determinístico
  const result = await handleRescheduleMessage(userMessage, state, userPhoneNumber, configId)

  console.log(`[RESCHEDULE-INTEGRATION] Resultado del handler:`, result.type)

  // ========================================
  // CASO 1: Turno seleccionado - mostrar confirmación
  // ========================================
  if (result.type === 'pending' && result.nextPhase === 'awaiting_confirmation' && result.turnoSeleccionado) {
    const confirmMsg = buildRescheduleConfirmationMessage(result.state!, result.turnoSeleccionado)
    await sendRescheduleResponse(ctx, confirmMsg)

    return {
      handled: true,
      fallbackToOpenAI: false,
    }
  }

  // ========================================
  // CASO 2: Volviendo a selección (usuario rechazó turno)
  // ========================================
  if (result.type === 'pending' && result.nextPhase === 'awaiting_selection' && result.state) {
    const rejectMsg = buildRescheduleRejectionMessage(result.state)
    const turnosMsg = buildRescheduleStartMessage(result.state, result.state.turnosDisponibles)
    
    await sendRescheduleResponse(ctx, rejectMsg)
    await sendRescheduleResponse(ctx, turnosMsg)

    return {
      handled: true,
      fallbackToOpenAI: false,
    }
  }

  // ========================================
  // CASO 3: Confirmación recibida → RESERVAR en el sistema externo (proxy)
  // El handler marca el flujo como 'completed', pero la reserva real contra el
  // proxy se ejecuta aquí. Solo si el proxy confirma se envía el mensaje de
  // éxito; de lo contrario se revierte a 'awaiting_confirmation' para reintentar.
  // ========================================
  if (result.type === 'completed' && result.state?.turnoReservado) {
    const st = result.state
    const turno = st.turnoReservado!

    // Ejecutar la reserva REAL en el sistema externo (proxy)
    let reservaExito = false
    let reservaError: string | undefined
    try {
      if (!clienteId) {
        reservaError = "clienteId ausente"
        console.error("[RESCHEDULE-INTEGRATION] No se puede reservar: clienteId ausente")
      } else if (!turno.agenda_id) {
        reservaError = "agenda_id ausente"
        console.error("[RESCHEDULE-INTEGRATION] No se puede reservar: turno.agenda_id ausente", turno)
      } else {
        const { reservarTurno } = await import("../openai-tools")
        const pacienteDatos: Record<string, unknown> = {
          dni: st.paciente.dni,
          nombre: st.paciente.nombres,
          apellido: st.paciente.apellido,
          telefono: st.paciente.telefono,
          ...(st.obra_social_id ? { obra_social_id: st.obra_social_id } : {}),
        }
        console.log(`[RESCHEDULE-INTEGRATION] Reservando turno en proxy (Agenda_Id: ${turno.agenda_id})`)
        const reservaRaw = await reservarTurno(clienteId, turno.agenda_id, pacienteDatos)
        const parsed = typeof reservaRaw === "string" ? JSON.parse(reservaRaw) : reservaRaw
        reservaExito = parsed?.exito === true
        if (!reservaExito) {
          reservaError = parsed?.error || parsed?.mensaje || "respuesta sin éxito"
          console.error("[RESCHEDULE-INTEGRATION] El proxy no confirmó la reserva:", reservaError)
        }
      }
    } catch (err) {
      reservaError = err instanceof Error ? err.message : "error desconocido"
      console.error("[RESCHEDULE-INTEGRATION] Error reservando turno en el proxy:", err)
    }

    // Si la reserva falló: revertir a awaiting_confirmation y avisar al usuario
    if (!reservaExito) {
      const revertState: RescheduleFlowState = {
        ...st,
        phase: 'awaiting_confirmation',
        turnoReservado: null,
      }
      await saveRescheduleState(userPhoneNumber, configId, revertState)
      await sendRescheduleResponse(
        ctx,
        "Hubo un problema al reagendar tu turno. Por favor, respondé *1* para reintentar o contactá a la clínica."
      )
      return {
        handled: true,
        fallbackToOpenAI: false,
      }
    }

    // Reserva exitosa → enviar confirmación
    const successMsg = buildRescheduleSuccessMessage(st, turno)
    await sendRescheduleResponse(ctx, successMsg)

    // Trackear éxito
    if (clienteId) {
      await trackAppointmentEvent({
        clienteId,
        phoneNumber: userPhoneNumber,
        eventType: "rescheduled",
        timestamp: new Date().toISOString(),
      })
    }

    // Sincronizar contexto persistente (Redis + thread OpenAI + post-action) para que
    // el turno cancelado deje de figurar como vigente en mensajes posteriores.
    await syncContextAfterReschedule(
      userPhoneNumber,
      configId,
      turno,
      st.paciente,
      st.obra_social_id,
      st.obra_social_nombre
    )

    // Limpiar estado
    await clearRescheduleState(userPhoneNumber, configId)

    return {
      handled: true,
      fallbackToOpenAI: false,
    }
  }

  // ========================================
  // CASO 4a: Búsqueda ampliada post-60-días (opción 1/2/3 del menú de no-turnos)
  // El handler ya limpió el estado; pasar a OpenAI con contexto del paciente precargado
  // ========================================
  if (result.type === 'fallback_to_openai' && result.fallbackContext?.intent === 'reschedule_broad_search') {
    const fc = result.fallbackContext
    console.log(`[RESCHEDULE-INTEGRATION] Búsqueda ampliada, tipo: ${fc.searchType}`)

    // Retornar sin manejar para que whatsapp.tsx lo route a OpenAI con el contexto del paciente
    return {
      handled: false,
      fallbackToOpenAI: true,
      fallbackContext: {
        type: 'reschedule_broad_search',
        searchType: fc.searchType,
        paciente: fc.paciente,
        pacienteDni: fc.pacienteDni,
        obraSocialId: fc.obraSocialId,
        sedeId: fc.sedeId,
        originalMessage: fc.originalMessage,
      },
    }
  }

  // ========================================
  // CASO 4b: Fallback a OpenAI para NLU (selección ambigua dentro del flujo)
  // ========================================
  if (result.type === 'fallback_to_openai' && result.fallbackContext) {
    console.log(`[RESCHEDULE-INTEGRATION] Fallback a OpenAI:`, result.fallbackContext.intent)

    // Mostrar mensaje de "procesando"
    const processingMsg = buildRescheduleOpenAIMessage(result.state || state, result.fallbackContext.intent)
    await sendRescheduleResponse(ctx, processingMsg)

    return {
      handled: false,
      fallbackToOpenAI: true,
      fallbackContext: {
        type: result.fallbackContext.intent,
        turnosDisponibles: state.turnosDisponibles,
        faseActual: state.phase,
        mensaje: userMessage,
      },
    }
  }

  // ========================================
  // CASO 5: Usuario abandona flujo
  // ========================================
  if (result.type === 'error' && result.message?.includes('abandona')) {
    const abandonMsg = buildRescheduleAbandonMessage(state)
    await sendRescheduleResponse(ctx, abandonMsg)
    await clearRescheduleState(userPhoneNumber, configId)

    return {
      handled: true,
      fallbackToOpenAI: false,
    }
  }

  // ========================================
  // CASO 6: Error genérico
  // ========================================
  if (result.type === 'error') {
    const errorMsg = result.message || buildRescheduleErrorMessage()
    await sendRescheduleResponse(ctx, errorMsg)

    return {
      handled: true,
      fallbackToOpenAI: false,
    }
  }

  // Default: no manejado
  return {
    handled: false,
    fallbackToOpenAI: false,
  }
}

/**
 * Verifica si hay un flujo de reagendamiento activo para este usuario
 */
export async function isRescheduleFlowActive(
  userPhoneNumber: string,
  configId: string
): Promise<boolean> {
  const state = await getRescheduleState(userPhoneNumber, configId)
  return state !== null && state.phase !== 'completed'
}

/**
 * Limpia el flujo de reagendamiento (por timeout, error, etc)
 */
export async function cleanupRescheduleFlow(
  userPhoneNumber: string,
  configId: string
): Promise<void> {
  await clearRescheduleState(userPhoneNumber, configId)
  console.log(`[RESCHEDULE-INTEGRATION] Flujo limpiado para ${userPhoneNumber}`)
}
