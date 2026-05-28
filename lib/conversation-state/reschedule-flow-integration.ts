/**
 * reschedule-flow-integration.ts
 * 
 * Integración del flujo de reagendamiento determinístico en whatsapp.tsx
 * Proporciona funciones para interceptar y procesar mensajes en el flujo de reagendamiento.
 */

import { sendWhatsAppMessage } from "./whatsapp-api"
import { saveConversationMessage } from "./conversations"
import { nanoid } from "nanoid"
import { updateWhatsAppStats } from "./db"
import { trackAppointmentEvent } from "./appointment-stats"
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
} from "./conversation-state/reschedule-flow-handler"
import {
  buildRescheduleStartMessage,
  buildRescheduleConfirmationMessage,
  buildRescheduleSuccessMessage,
  buildRescheduleSelectionErrorMessage,
  buildRescheduleRejectionMessage,
  buildRescheduleAbandonMessage,
  buildRescheduleErrorMessage,
  buildRescheduleOpenAIMessage,
} from "./conversation-state/reschedule-templates"
import type { ChatbotData } from "./appointment-flow-state"

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
  // CASO 3: Reserva completada exitosamente
  // ========================================
  if (result.type === 'completed' && result.state?.turnoReservado) {
    const successMsg = buildRescheduleSuccessMessage(result.state, result.state.turnoReservado)
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

    // Limpiar estado
    await clearRescheduleState(userPhoneNumber, configId)

    return {
      handled: true,
      fallbackToOpenAI: false,
    }
  }

  // ========================================
  // CASO 4: Fallback a OpenAI para NLU
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
