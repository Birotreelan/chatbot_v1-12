import { getWhatsAppConfigByPhoneId, updateWhatsAppStats, getThreadForUser, resetThreadForUser, clearThreadAssistantId, clearAllConversationStates } from "@/lib/db"
import { sendWhatsAppMessage, sendWhatsAppInteractive, sendWhatsAppList } from "@/lib/whatsapp-api"
import { transcribeWhatsAppAudio } from "@/lib/audio-transcription"
import { getAssistantResponse } from "@/lib/openai-tools"
import { getArgentinaDateTime } from "@/lib/utils/date-utils"
import { normalizePhoneNumber } from "@/lib/utils"
import { getRedisClient } from "./redis"
import { enqueueUserMessage } from "./user-queue"
import { saveConversationMessage, isConversationPaused, type ConversationMessage } from "./conversations"
import { nanoid } from "nanoid"
import { TIMEOUTS, fetchWithRetry } from "./config/timeouts"
import { trackAppointmentEvent, getTemplateSentTime, checkAndTrackUserInitiated, markPendingReschedule, getTemplateTrackingData } from "./appointment-stats"
import {
  getActiveSessionByPhone,
  addPendingMessageToSession,
  saveSupportMessage,
  getPendingHumanSupportOffer,
  clearPendingHumanSupportOffer,
  createSupportSession,
} from "./human-support"
import type { HumanSupportMessage } from "./types"
import { formatScheduleForSystemBlock } from "./utils/schedule-formatter"
import {
  getAppointmentContext,
  saveAppointmentContext,
  getFlowState,
  setFlowState,
  clearFlowState,
  clearAppointmentContext,
  clearAppointmentTurnos,
  isConfirmCancelResponse,
  isKeepAppointmentResponse,
  isRescheduleChoice,
  isCancelAndRescheduleChoice,
  markAppointmentConfirmed,
  isAppointmentConfirmed,
  getAppointmentRef,
  type ChatbotData,
  type ChatbotDataTurno,
  type ChatbotDataTurnoCancelado,
} from "./appointment-flow-state"
import {
  buildConfirmationMessage,
  buildConfirmationMessageNoName,
  buildCancelDoubleConfirmMessage,
  buildCancellationSuccessMessage,
  buildTurnoSelectionMessage,
  buildCancelAllDoubleConfirmMessage,
  buildCancelAllSuccessMessage,
  buildKeepAppointmentMessage,
  buildNoRescheduleMessage,
  buildNoRescheduleMessageFallback,
  buildRescheduleStartMessage,
  buildAlreadyCancelledMessage,
} from "./direct-response-templates"
import { createConversationLogger } from "./conversation-state/logger"
import { getEffectiveFeatureFlags } from "./conversation-state/feature-flags"
import { handleFarewellIfDetected, detectFarewellPreFlow, detectReciprocalFarewellPreFlow } from "./conversation-state/farewell-handler"
import { detectWrongNumberPreFlow, setWrongPersonState } from "./conversation-state/wrong-number-handler"
import { detectDirectConfirmationPreFlow, buildCancelConfirmationPrompt, buildAskExplicitConfirmationMessage } from "./conversation-state/direct-confirmation-handler"
import { detectInformationalQueryPreFlow } from "./conversation-state/informational-query-handler"
import { detectPostActionContextPreFlow, savePostActionContext } from "./conversation-state/post-action-context"
import { detectNLUFallbackPreFlow } from "./conversation-state/nlu-fallback-handler"
import { appendToHistory } from "./conversation-state/conversation-history"
import {
  handleTurnSelectionIfPending,
  buildInvalidSelectionMessage,
  buildTurnSelectedMessage,
} from "./conversation-state/turn-selection-handler"
import {
  handleDNIIfAwaiting,
} from "./conversation-state/dni-handler"
import {
  handleBookingSelectionIfPending,
  getBookingFlowState,
  setBookingFlowState,
  buildBookingContextBlock,
  clearBookingFlowState,
} from "./conversation-state/booking-flow-handler"
import {
  mapApiTurnosToOptions,
  buildNewDateSearchTurnoListMessage,
} from "./conversation-state/booking-turno-filter"
import { obtenerTurnos } from "./api-tools/api-functions"
import {
  fetchSedes,
  buildSedesMessage,
} from "./conversation-state/shared/sede-handler"
import {
  startRescheduleFlow,
  processRescheduleMessage,
  isRescheduleFlowActive,
} from "./conversation-state/reschedule-flow-integration"
import { getEffectiveFeatureFlags as getFeatureFlagsForReschedule } from "./conversation-state/feature-flags"
import {
  initializePatientDetection,
  handlePatientDetectionMessage,
  handleDNIForMultiplePatients,
  shouldUsePatientDetection,
  completePatientDetectionFlow,
  isPatientDetectionFlowActive,
  updatePatientDetectionPhase,
  getIdentifiedPatient,
  clearPatientDetectionFlow,
  returnPatientToMenu,
  resetDetectionToMainMenu,
  restoreDetectionStateFromCache,
} from "./conversation-state/patient-detection/patient-flow-integration"
import {
  initializeExistingPatientFlow,
  handleExistingPatientMessage,
  isExistingPatientFlowActive,
  clearExistingPatientFlow,
  getExistingPatientFlowPhase,
} from "./conversation-state/existing-patient/existing-patient-flow-integration"
import {
  initializeNewPatientFlow,
  handleNewPatientMessage,
  isNewPatientFlowActive,
  clearNewPatientFlow,
} from "./conversation-state/new-patient/new-patient-flow-integration"
import {
  handleContextualIntent,
  type ContextualIntentResult,
} from "./conversation-state/pending-flow-nlu/contextual-intent-handler"
import { buildDispatcherContext } from "./conversation-state/ai-dispatcher/context-builder"
import { runAIDispatcher } from "./conversation-state/ai-dispatcher/dispatcher"
import { executeDispatcherDecision, type ExecutorDeps } from "./conversation-state/ai-dispatcher/tool-executor"


// Función para extraer el contenido del mensaje según su tipo
function extractMessageContent(message: any): { content: string; audioId?: string; audioMimeType?: string } {
  switch (message.type) {
    case "text":
      return { content: message.text?.body || "" }
    case "button":
      return { content: message.button?.text || message.button?.payload || "" }
    case "interactive":
      if (message.interactive?.type === "button_reply") {
        return { content: message.interactive.button_reply?.id || message.interactive.button_reply?.title || "" }
      } else if (message.interactive?.type === "list_reply") {
        return { content: message.interactive.list_reply?.id || message.interactive.list_reply?.title || "" }
      }
      return { content: "" }
    case "audio":
      // For audio messages, return the audio ID for later transcription
      return {
        content: "",
        audioId: message.audio?.id,
        audioMimeType: message.audio?.mime_type || "audio/ogg",
      }
    default:
      return { content: "" }
  }
}

// Función para verificar si un mensaje ya ha sido procesado
async function isMessageProcessed(messageId: string): Promise<boolean> {
  try {
    const redisClient = getRedisClient()
    if (!redisClient) {
      console.warn("[WHATSAPP] Redis no disponible, no se puede verificar duplicados")
      return false
    }

    const key = `processed_message:${messageId}`
    const exists = await redisClient.get(key)
    return exists !== null
  } catch (error) {
    console.error("[WHATSAPP] Error verificando mensaje procesado:", error)
    return false
  }
}

// Función para marcar un mensaje como procesado
async function markMessageAsProcessed(messageId: string): Promise<void> {
  try {
    const redisClient = getRedisClient()
    if (!redisClient) {
      console.warn("[WHATSAPP] Redis no disponible, no se puede marcar mensaje como procesado")
      return
    }

    const key = `processed_message:${messageId}`
    // Guardar por 24 horas (86400 segundos)
    await redisClient.set(key, "1", { ex: 86400 })

  } catch (error) {
    console.error("[WHATSAPP] Error marcando mensaje como procesado:", error)
  }
}

// ============================================================================
// RESPUESTAS DIRECTAS (SIN OPENAI) PARA FLUJOS DE CONFIRMACION/CANCELACION
// ============================================================================

interface DirectResponseContext {
  phoneNumberId: string
  accessToken: string
  userPhoneNumber: string
  configId: string
  clienteId?: string
}

/**
 * Envia una respuesta directa al usuario y guarda en el historial
 */
async function sendDirectResponse(
  ctx: DirectResponseContext,
  message: string,
  phase = "direct"
): Promise<boolean> {
  const logger = createConversationLogger(ctx.userPhoneNumber, ctx.configId, phase)
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

    // Guardar en historial conversacional (para entity extractor y response generator)
    appendToHistory(ctx.userPhoneNumber, { role: 'bot', text: message, timestamp: Date.now() }).catch(() => {})

    await updateWhatsAppStats(ctx.configId, { messagesProcessed: 1 })

    logger.info("Respuesta directa enviada", { messageLength: message.length })
    return true
  } catch (error) {
    logger.error("Error enviando respuesta directa", error as Error)
    return false
  }
}

/**
 * Envía el resultado de initializeExistingPatientFlow o handleExistingPatientMessage.
 * - Si tiene sedesListRows → WhatsApp List Message
 * - Si tiene searchTypeButtons → WhatsApp Reply Buttons
 * - De lo contrario → texto plano vía sendDirectResponse
 */
async function sendExistingPatientResult(
  ctx: DirectResponseContext,
  result: {
    message?: string
    sedesListRows?: Array<{ id: string; title: string; description?: string }>
    searchTypeButtons?: Array<{ id: string; title: string }>
    verMasButton?: boolean
  },
  phase = "existing_patient_flow"
): Promise<void> {
  if (!result.message) return

  const _saveHistory = async (msg: string) => {
    await saveConversationMessage({ id: nanoid(), role: "assistant", content: msg, timestamp: new Date().toISOString(), phoneNumber: ctx.userPhoneNumber, configId: ctx.configId })
    appendToHistory(ctx.userPhoneNumber, { role: 'bot', text: msg, timestamp: Date.now() }).catch(() => {})
    await updateWhatsAppStats(ctx.configId, { messagesProcessed: 1 })
  }

  // List Message para selección de sede
  if (result.sedesListRows && result.sedesListRows.length > 0) {
    try {
      await sendWhatsAppList(ctx.phoneNumberId, ctx.accessToken, ctx.userPhoneNumber, result.message, "Ver sedes", result.sedesListRows, "Sedes disponibles")
      await _saveHistory(result.message)
      return
    } catch (listErr) {
      console.error("[WHATSAPP] Error enviando sede list message, fallback a texto:", listErr)
    }
  }

  // Reply Buttons para tipo de búsqueda
  if (result.searchTypeButtons && result.searchTypeButtons.length > 0) {
    try {
      await sendWhatsAppInteractive(ctx.phoneNumberId, ctx.accessToken, ctx.userPhoneNumber, result.message, result.searchTypeButtons)
      await _saveHistory(result.message)
      return
    } catch (btnErr) {
      console.error("[WHATSAPP] Error enviando search type buttons, fallback a texto:", btnErr)
    }
  }

  // Reply Button "Ver más" para paginación de turnos
  if (result.verMasButton) {
    try {
      await sendWhatsAppInteractive(ctx.phoneNumberId, ctx.accessToken, ctx.userPhoneNumber, result.message, [
        { id: "ver_mas", title: "Ver más" },
      ])
      await _saveHistory(result.message)
      return
    } catch (btnErr) {
      console.error("[WHATSAPP] Error enviando Ver más button, fallback a texto:", btnErr)
    }
  }

  await sendDirectResponse(ctx, result.message, phase)
}

/**
 * Confirma un turno contra el sistema externo (proxy).
 * Devuelve true solo si el proxy respondió success === true.
 * Centraliza el payload de "confirmar_turno" para que todos los caminos de
 * confirmación (turno único y selección múltiple) impacten en el sistema externo.
 */
async function confirmarTurnoEnProxy(
  config: any,
  chatbotData: ChatbotData,
  turnoIndex: number,
  userPhoneNumber: string
): Promise<boolean> {
  const turno = chatbotData.turnos?.[turnoIndex]
  const dni = chatbotData.paciente?.dni
  const fecha = turno?.fecha

  if (!config?.proxy || !fecha || !dni) {
    console.warn("[PROXY] Confirmacion de turno omitida — datos insuficientes", {
      tieneProxy: !!config?.proxy,
      tieneFecha: !!fecha,
      tieneDni: !!dni,
    })
    return false
  }

  try {
    const confirmPayload = {
      Cliente_Id: config.cliente_id,
      Action: "confirmar_turno",
      fecha,
      paciente_datos: { dni },
    }
    console.info("[PROXY] Enviando confirmacion de turno", { url: config.proxy, payload: confirmPayload })
    const response = await fetchWithRetry(
      config.proxy,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(confirmPayload),
      },
      TIMEOUTS.PROXY_TIMEOUT,
      { maxRetries: 2, initialDelayMs: 2000, maxDelayMs: 10000, backoffMultiplier: 2 }
    )

    let proxyBody: { success?: boolean; [key: string]: unknown } | null = null
    try {
      const bodyText = await response.text()
      proxyBody = bodyText ? JSON.parse(bodyText) : null
    } catch {
      proxyBody = null
    }
    console.info("[PROXY] Respuesta confirmacion de turno", {
      httpStatus: response.status,
      ok: response.ok,
      body: proxyBody,
    })

    const proxySuccess = response.ok && proxyBody?.success === true
    if (proxySuccess && config.cliente_id) {
      await trackAppointmentEvent({
        clienteId: config.cliente_id,
        phoneNumber: userPhoneNumber,
        eventType: "confirmed",
        timestamp: new Date().toISOString(),
        metadata: { source: "user_initiated_menu", turnoIndex, proxyBody },
      })
    }
    // Marcar el turno como confirmado para no volver a ofrecer "Confirmar asistencia"
    if (proxySuccess && config.id) {
      await markAppointmentConfirmed(userPhoneNumber, config.id, getAppointmentRef(chatbotData))
    }
    return proxySuccess
  } catch (error) {
    console.error("[PROXY] Error al confirmar turno", error)
    return false
  }
}

/**
 * Maneja respuestas de doble confirmacion de cancelacion ("1"/"2")
 * Retorna:
 * - false: respuesta no manejada, continuar a OpenAI
 * - true: respuesta manejada completamente
 * - object: respuesta especial (ej: reagendamiento) que necesita procesamiento posterior
 */
async function handlePendingFlowResponse(
  userMessage: string,
  userPhoneNumber: string,
  config: any,
  phoneNumberId: string,
  value: any
): Promise<boolean | { type: 'route_to_reagendamiento'; chatbotData: ChatbotData; turnoIndex: number }> {
  // Verificar feature flags - si directCancellation está OFF, pasar todo a OpenAI
  const flags = await getEffectiveFeatureFlags(config.id)
  const logger = createConversationLogger(userPhoneNumber, config.id, "pending-flow")

  if (!flags.directCancellation) {
    logger.info("directCancellation flag OFF, pasando a OpenAI")
    return false
  }

  // Verificar si hay un flujo pendiente
  const flowState = await getFlowState(userPhoneNumber, config.id)
  if (!flowState) return false

  logger.info("Flujo pendiente detectado", { type: flowState.type })

  const ctx: DirectResponseContext = {
    phoneNumberId,
    accessToken: config.accessToken,
    userPhoneNumber,
    configId: config.id,
    clienteId: config.cliente_id,
  }

  // Obtener contexto del turno (puede ser null si ya fue limpiado post-cancelación)
  const chatbotData = await getAppointmentContext(userPhoneNumber, config.id)

  // Manejar segun el tipo de flujo

  // El paciente tenía varios turnos y le pedimos elegir sobre cuál operar.
  // Acá recibimos el número del turno elegido y derivamos a la acción pendiente.
  if (flowState.type === 'awaiting_turno_selection') {
    if (!chatbotData || !chatbotData.turnos || chatbotData.turnos.length === 0) {
      logger.warn("No hay contexto de turnos para awaiting_turno_selection, pasando a OpenAI")
      await clearFlowState(userPhoneNumber, config.id)
      return false
    }

    const pendingAction = flowState.pendingAction || 'cancel_appointment'
    const esCancelacion = pendingAction === 'cancel_appointment' || pendingAction === 'cancel_and_book_new_appointment'

    // Para cancelación, los turnos se agrupan por fecha (el backend cancela el día completo).
    // Calculamos cuántas opciones hay realmente en el menú mostrado.
    let gruposFechaOrdenados: string[] = []
    if (esCancelacion) {
      const fechasUnicas: string[] = []
      for (const t of chatbotData.turnos) {
        const f = t.fecha || t.Fecha
        if (f && !fechasUnicas.includes(f)) fechasUnicas.push(f)
      }
      gruposFechaOrdenados = fechasUnicas
    }

    const totalOpciones = esCancelacion ? gruposFechaOrdenados.length : chatbotData.turnos.length
    // Para cancelación, existe una opción extra "cancelar todos" al final
    const opcionCancelarTodos = esCancelacion ? totalOpciones + 1 : null
    const maxOpcion = opcionCancelarTodos ?? totalOpciones

    // Extraer el primer número del mensaje (ej: "2", "el 2", "quiero el 2")
    const match = userMessage.match(/\d+/)
    const seleccion = match ? parseInt(match[0], 10) : NaN

    if (isNaN(seleccion) || seleccion < 1 || seleccion > maxOpcion) {
      // Selección inválida: re-mostrar la lista sin cambiar el estado
      logger.warn("Selección de turno inválida", { userMessage, total: chatbotData.turnos.length })
      const retryMsg = buildTurnoSelectionMessage(
        chatbotData,
        pendingAction as
          | 'confirm_appointment'
          | 'cancel_appointment'
          | 'cancel_and_book_new_appointment'
      )
      await sendDirectResponse(ctx, retryMsg, "turno_selection")
      return true
    }

    // El paciente eligió "cancelar todos los turnos agendados"
    if (opcionCancelarTodos !== null && seleccion === opcionCancelarTodos) {
      logger.info("Paciente eligió cancelar TODOS los turnos", { total: chatbotData.turnos.length })
      await setFlowState(userPhoneNumber, config.id, {
        type: 'awaiting_cancel_all_confirmation',
        createdAt: new Date().toISOString(),
      })
      const confirmAllMsg = buildCancelAllDoubleConfirmMessage(chatbotData)
      await sendDirectResponse(ctx, confirmAllMsg, "cancel_all_flow")
      return true
    }

    // Mapear la opción elegida al índice real del turno
    // Para cancelación: la opción corresponde a un grupo de fecha → primer turno de ese grupo
    let turnoIndex: number
    if (esCancelacion && gruposFechaOrdenados.length > 0) {
      const fechaElegida = gruposFechaOrdenados[seleccion - 1]
      turnoIndex = chatbotData.turnos.findIndex((t: any) => (t.fecha || t.Fecha) === fechaElegida)
      if (turnoIndex < 0) turnoIndex = seleccion - 1 // fallback
    } else {
      turnoIndex = seleccion - 1
    }

    if (pendingAction === 'confirm_appointment') {
      // Confirmar asistencia al turno elegido — primero impactar en el sistema externo (proxy)
      const proxySuccess = await confirmarTurnoEnProxy(config, chatbotData, turnoIndex, userPhoneNumber)
      await clearFlowState(userPhoneNumber, config.id)

      if (!proxySuccess) {
        await sendDirectResponse(
          ctx,
          "Hubo un problema al confirmar tu turno. Por favor intentá de nuevo en unos momentos.",
          "confirm_flow_error"
        )
        return true
      }

      const confirmMsg = buildConfirmationMessage(chatbotData, turnoIndex)
      await sendDirectResponse(ctx, confirmMsg, "confirm_flow")

      // Marcar como confirmados el turno elegido y todos los de la misma fecha
      // (el backend confirma todos los turnos de la misma fecha juntos)
      const fechaConfirmada = chatbotData.turnos[turnoIndex]?.fecha || chatbotData.turnos[turnoIndex]?.Fecha
      const updatedTurnosAfterConfirm = (chatbotData.turnos || []).map((t: any, i: number) => {
        const tFecha = t.fecha || t.Fecha
        return (i === turnoIndex || (fechaConfirmada && tFecha === fechaConfirmada))
          ? { ...t, Estado: 'Confirmado', estado: 'Confirmado' }
          : t
      })
      const menuMsgAfterConfirm = await returnPatientToMenu(userPhoneNumber, updatedTurnosAfterConfirm, 'just_confirmed')
      if (menuMsgAfterConfirm) await sendDirectResponse(ctx, menuMsgAfterConfirm, "return_to_menu")

      return true
    }

    // Cancelación (o cancelar+solicitar nuevo) del turno elegido: pedir doble confirmación
    const wantsBookNew = pendingAction === 'cancel_and_book_new_appointment'
    await setFlowState(userPhoneNumber, config.id, {
      type: 'awaiting_cancel_confirmation',
      createdAt: new Date().toISOString(),
      turnoIndex,
      ...(wantsBookNew ? { postCancelAction: 'book_new' as const } : {}),
    })
    const doubleConfirmMsg = buildCancelDoubleConfirmMessage(chatbotData, turnoIndex)
    await sendDirectResponse(ctx, doubleConfirmMsg, "cancel_flow")
    return true
  }

  // Doble confirmación para cancelar TODOS los turnos del paciente.
  if (flowState.type === 'awaiting_cancel_all_confirmation') {
    if (!chatbotData || !chatbotData.turnos || chatbotData.turnos.length === 0) {
      logger.warn("No hay contexto de turnos para awaiting_cancel_all_confirmation, pasando a OpenAI")
      await clearFlowState(userPhoneNumber, config.id)
      return false
    }

    if (isKeepAppointmentResponse(userMessage)) {
      logger.info("Usuario decide mantener todos los turnos")
      await clearFlowState(userPhoneNumber, config.id)
      await sendDirectResponse(ctx, "Perfecto, mantenemos todos tus turnos agendados. ¿En qué más te puedo ayudar?", "cancel_all_flow")
      return true
    }

    if (!isConfirmCancelResponse(userMessage)) {
      // Respuesta no reconocida: re-mostrar la doble confirmación
      logger.warn("Respuesta no reconocida en awaiting_cancel_all_confirmation", { userMessage })
      const retryMsg = buildCancelAllDoubleConfirmMessage(chatbotData)
      await sendDirectResponse(ctx, retryMsg, "cancel_all_flow")
      return true
    }

    // Confirmado: cancelar todos los turnos uno por uno vía proxy
    logger.info("Cancelando TODOS los turnos", { total: chatbotData.turnos.length })
    const totalTurnos = chatbotData.turnos.length
    let cancelados = 0
    const fallidos: string[] = []

    for (const turno of chatbotData.turnos) {
      try {
        const proxyPayload = {
          Cliente_Id: config.cliente_id,
          Action: "cancelar_turno",
          fecha: turno?.fecha,
          paciente_datos: {
            dni: chatbotData.paciente?.dni,
          },
        }
        const response = await fetchWithRetry(
          config.proxy,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(proxyPayload),
          },
          TIMEOUTS.PROXY_TIMEOUT,
          { maxRetries: 2, initialDelayMs: 2000, maxDelayMs: 10000, backoffMultiplier: 2 }
        )

        let proxyBody: { success?: boolean; [key: string]: unknown } | null = null
        try {
          const bodyText = await response.text()
          proxyBody = bodyText ? JSON.parse(bodyText) : null
        } catch {
          proxyBody = null
        }

        if (response.ok && proxyBody?.success === true) {
          cancelados++
          if (config.cliente_id) {
            await trackAppointmentEvent({
              clienteId: config.cliente_id,
              phoneNumber: userPhoneNumber,
              eventType: "cancelled",
              timestamp: new Date().toISOString(),
              metadata: { source: "cancel_all", proxyBody },
            })
          }
        } else {
          logger.error("Falló cancelación de un turno en cancelar-todos", undefined, {
            fecha: turno?.fecha,
            httpStatus: response.status,
            body: proxyBody,
          })
          fallidos.push(`${turno?.fecha_formateada || turno?.fecha} a las ${turno?.hora_formateada || turno?.hora}`)
        }
      } catch (error) {
        logger.error("Error al cancelar un turno en cancelar-todos", error as Error)
        fallidos.push(`${turno?.fecha_formateada || turno?.fecha} a las ${turno?.hora_formateada || turno?.hora}`)
      }
    }

    await clearFlowState(userPhoneNumber, config.id)

    if (cancelados === totalTurnos) {
      // Todos cancelados con éxito: limpiar contexto por completo
      await clearAppointmentContext(userPhoneNumber, config.id)
      const successMsg = buildCancelAllSuccessMessage(chatbotData)
      await sendDirectResponse(ctx, successMsg, "cancel_all_flow")
    } else if (cancelados > 0) {
      // Cancelación parcial
      await sendDirectResponse(
        ctx,
        `Cancelamos ${cancelados} de ${totalTurnos} turnos. No pudimos cancelar: ${fallidos.join("; ")}. Por favor intentá de nuevo en unos momentos o comunicate con la clínica.`,
        "cancel_all_flow"
      )
    } else {
      // Ninguno cancelado
      await sendDirectResponse(
        ctx,
        "Hubo un problema al cancelar tus turnos. Por favor intentá de nuevo en unos momentos.",
        "cancel_all_flow"
      )
    }
    return true
  }

  if (flowState.type === 'awaiting_cancel_confirmation') {
    // awaiting_cancel_confirmation siempre necesita chatbotData
    if (!chatbotData) {
      logger.warn("No hay contexto de turno para awaiting_cancel_confirmation, pasando a OpenAI")
      await clearFlowState(userPhoneNumber, config.id)
      return false
    }
    // Usuario responde a "1- Si, cancelar" / "2- No, mantener"
    if (isConfirmCancelResponse(userMessage)) {
      
      // Llamar al proxy para ejecutar la cancelacion
      try {
        const turnoACancelar = chatbotData.turnos[flowState.turnoIndex || 0]
        const proxyPayload = {
          Cliente_Id: config.cliente_id,
          Action: "cancelar_turno",
          fecha: turnoACancelar?.fecha,
          paciente_datos: {
            dni: chatbotData.paciente?.dni,
          },
        }

        logger.info("Enviando cancelacion al proxy")
        const response = await fetchWithRetry(
          config.proxy,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(proxyPayload),
          },
          TIMEOUTS.PROXY_TIMEOUT,
          { maxRetries: 2, initialDelayMs: 2000, maxDelayMs: 10000, backoffMultiplier: 2 }
        )

        // Leer el body del proxy siempre, independientemente del HTTP status
        let proxyBody: { success?: boolean; [key: string]: unknown } | null = null
        let proxyBodyText = ""
        try {
          proxyBodyText = await response.text()
          proxyBody = proxyBodyText ? JSON.parse(proxyBodyText) : null
        } catch {
          // Si el body no es JSON válido, lo tratamos como fallo
          proxyBody = null
        }
        logger.info("Respuesta del proxy (cancelacion)", {
          httpStatus: response.status,
          body: proxyBody,
        })

        // El éxito depende de response.ok Y de que el body indique success: true
        const proxySuccess = response.ok && proxyBody?.success === true

        if (!proxySuccess) {
          logger.error("El proxy no confirmó la cancelacion", undefined, {
            httpStatus: response.status,
            proxySuccess: proxyBody?.success,
            body: proxyBody,
          })
          // NO limpiar flowState: mantener contexto para reintento o manejo de error
          const ctx: DirectResponseContext = {
            phoneNumberId,
            accessToken: config.accessToken,
            userPhoneNumber,
            configId: config.id,
            clienteId: config.cliente_id,
          }
          await sendDirectResponse(ctx, "Hubo un problema al cancelar el turno. Por favor intentá de nuevo en unos momentos.", "cancel_proxy_error")
          return true
        }

        // proxySuccess === true garantizado en este punto
        await clearFlowState(userPhoneNumber, config.id)
        // Limpieza selectiva: vacía turnos[] pero preserva paciente + turno_cancelado
        // para que los pre-flows no vean el turno cancelado y el reagendamiento tenga datos
        await clearAppointmentTurnos(userPhoneNumber, config.id, flowState.turnoIndex || 0)

        if (config.cliente_id) {
          const templateSentAt = await getTemplateSentTime(config.cliente_id, userPhoneNumber)
          await trackAppointmentEvent({
            clienteId: config.cliente_id,
            phoneNumber: userPhoneNumber,
            eventType: "cancelled",
            timestamp: new Date().toISOString(),
            templateSentAt: templateSentAt || undefined,
            metadata: { source: "direct_flow", proxyBody },
          })
          await markPendingReschedule(config.cliente_id, userPhoneNumber)
        }

        // Sincronizar el thread de OpenAI: el thread fue sembrado por el template con un
        // bloque [CONTEXTO_COMPLETO_TURNO] del turno ahora CANCELADO. Sin esta actualización,
        // cualquier mensaje libre posterior ("¿podré obtener otro turno?") cae al asistente
        // OpenAI, cuyo thread sigue viendo el turno cancelado como vigente y responde con datos
        // obsoletos. Inyectamos un mensaje de actualización para que ignore el turno cancelado.
        // Best-effort: no bloquea el flujo de éxito.
        try {
          const threadInfo = await getThreadForUser(userPhoneNumber, config.id)
          const threadId = threadInfo?.threadId
          if (threadId) {
            const turnoCanceladoThread = chatbotData.turnos[flowState.turnoIndex || 0]
            const cancelUpdateMessage = `[SISTEMA_ACTUALIZACION_TURNO]
El turno que figuraba en el contexto anterior fue CANCELADO exitosamente y YA NO ES VÁLIDO.
IMPORTANTE: Ignorá por completo ese turno cancelado. El paciente NO tiene ningún turno vigente en este momento.
Turno cancelado (solo referencia, NO vigente): ${turnoCanceladoThread?.fecha_formateada || turnoCanceladoThread?.fecha || ""} ${turnoCanceladoThread?.hora_formateada || turnoCanceladoThread?.hora || ""} con ${turnoCanceladoThread?.profesional || ""} en ${turnoCanceladoThread?.sede || ""}.
Si el paciente pregunta por sacar/obtener otro turno, ayudalo a iniciar una NUEVA solicitud de turno; no lo refieras al turno cancelado.
[/SISTEMA_ACTUALIZACION_TURNO]`
            const { safelyAddMessageToThread } = await import("./thread-manager")
            await safelyAddMessageToThread(threadId, { role: "user", content: cancelUpdateMessage })
            logger.info("Thread de OpenAI actualizado tras cancelación (turno ya no vigente)")
          }
        } catch (threadError) {
          logger.error("Error actualizando thread de OpenAI tras cancelación", threadError as Error)
        }

        // Si el paciente venía del menú "Cancelar el turno médico y solicitar uno nuevo"
        // (postCancelAction='reschedule'), tras confirmar y cancelar exitosamente
        // redirigimos al flujo de reagendamiento usando turno_cancelado (Sprint 41).
        if (flowState.postCancelAction === 'reschedule') {
          await clearFlowState(userPhoneNumber, config.id)
          // Releer contexto actualizado: turnos[] vacío + turno_cancelado seteado
          const updatedChatbotData = await getAppointmentContext(userPhoneNumber, config.id)
          logger.info("Cancelación confirmada, redirigiendo a reagendamiento")
          return {
            type: 'route_to_reagendamiento',
            chatbotData: updatedChatbotData || chatbotData,
            turnoIndex: flowState.turnoIndex || 0,
          }
        }

        // Si el paciente eligió "Cancelar y solicitar uno nuevo" (opción 3 del menú con turnos),
        // tras la cancelación exitosa iniciamos directamente el flujo de reserva de un turno nuevo.
        if (flowState.postCancelAction === 'book_new') {
          logger.info("Cancelacion exitosa, iniciando flujo de reserva nueva (postCancelAction=book_new)")

          // Confirmar la cancelación antes de iniciar la reserva nueva.
          // includeRescheduleOffer=false: el paciente ya eligió "cancelar y solicitar uno nuevo",
          // por lo que NO se muestra el menú de reagendamiento (1. Reagendar / 2. No reagendar);
          // en su lugar transicionamos directamente al flujo de reserva (selección de sede).
          const cancelMsg = buildCancellationSuccessMessage(chatbotData, flowState.turnoIndex || 0, false)
          await sendDirectResponse(ctx, cancelMsg, "cancel_and_book_new")

          // Recuperar identificadores del paciente desde el cache de detección
          const identified = await getIdentifiedPatient(userPhoneNumber)

          // IMPORTANTE: limpiar el estado de detección de paciente (Sprint 9a) que pudo
          // quedar activo. Si no se borra, el bloque de intercepción evalúa
          // isPatientDetectionFlowActive ANTES que isExistingPatientFlowActive y enruta la
          // próxima selección de sede (ej. "3") a handlePatientDetectionMessage → NLU →
          // OpenAI, que re-saluda y vuelve a pedir el DNI (se pierde el flujo de reserva).
          // clearPatientDetectionFlow además persiste la identidad del paciente por 1h.
          await clearPatientDetectionFlow(userPhoneNumber, config.id)

          // Pasar explícitamente nombre/apellido y obra social en additionalPatientData.
          // IMPORTANTE: clearPatientDetectionFlow (arriba) borró el estado de detección, por lo
          // que initializeExistingPatientFlow ya NO puede recuperar firstName/lastName vía
          // getDetectedPatientInfo. Sin esto, el resumen final "DATOS DEL PACIENTE" queda vacío.
          // chatbotData.paciente tiene nombres + apellido del turno cancelado.
          const bookingResult = await initializeExistingPatientFlow(
            userPhoneNumber,
            identified?.patientId || "",
            identified?.patientName || chatbotData.paciente?.nombres || "",
            identified?.patientDNI || chatbotData.paciente?.dni || "",
            undefined,
            config.cliente_id,
            {
              patientFirstName: chatbotData.paciente?.nombres || undefined,
              patientLastName: chatbotData.paciente?.apellido || undefined,
              obraSocialId: identified?.obraSocialId,
              obraSocialNombre: identified?.obraSocialNombre,
            },
            config.escalationPhoneNumber
          )

          if (bookingResult?.handled && bookingResult.message) {
            await sendExistingPatientResult(ctx, bookingResult, "cancel_and_book_new")
          }
          return true
        }

        const turno = chatbotData.turnos[flowState.turnoIndex || 0]
        const admiteReagendamiento = turno?.admite_reagendamiento !== false
        logger.info("Cancelacion exitosa via proxy", { admiteReagendamiento })

        if (admiteReagendamiento) {
          await setFlowState(userPhoneNumber, config.id, {
            type: 'awaiting_reschedule_choice',
            createdAt: new Date().toISOString(),
            turnoIndex: flowState.turnoIndex || 0
          })
        }

        // Guardar contexto post-acción para mensajes contextuales posteriores
        // Ej: "Está con neumonía" como explicación de por qué canceló
        const turnoIndex = flowState.turnoIndex || 0
        const turnoCancelado = chatbotData.turnos[turnoIndex]
        if (turnoCancelado) {
          await savePostActionContext(userPhoneNumber, config.id, {
            timestamp: Date.now(),
            actionType: "cancellation",
            turno: {
              fecha: turnoCancelado.fecha,
              hora: turnoCancelado.hora,
              profesional: turnoCancelado.profesional || "",
              profesional_id: turnoCancelado.profesional_id?.toString(),
              sede: turnoCancelado.sede || "",
              sede_id: turnoCancelado.sede_id?.toString(),
              direccion: turnoCancelado.direccion,
            },
            paciente: {
              nombres: chatbotData.paciente?.nombres || "",
              apellido: chatbotData.paciente?.apellido || "",
              dni: chatbotData.paciente?.dni,
              telefono: userPhoneNumber,
            },
          })
          logger.info("Contexto post-acción guardado (cancelación)")
        }

        const successMsg = buildCancellationSuccessMessage(chatbotData, flowState.turnoIndex || 0)
        await sendDirectResponse(ctx, successMsg, "awaiting_cancel_confirmation")

        // Si no hay flujo de reagendamiento, el turno quedó cancelado → volver al menú sin él
        if (!admiteReagendamiento) {
          const cancelledIdx = flowState.turnoIndex || 0
          // El backend cancela todos los turnos del mismo día juntos → filtrar por fecha
          const cancelledFecha = chatbotData.turnos[cancelledIdx]?.fecha
          const remainingAfterCancel = (chatbotData.turnos || []).filter((t: any, i: number) => {
            if (i === cancelledIdx) return false
            if (cancelledFecha && (t.fecha || t.Fecha) === cancelledFecha) return false
            return true
          })
          const menuAfterCancel = await returnPatientToMenu(userPhoneNumber, remainingAfterCancel, 'just_cancelled')
          if (menuAfterCancel) await sendDirectResponse(ctx, menuAfterCancel, "return_to_menu")
        }

        return true
      } catch (error) {
        logger.error("Error al cancelar via proxy", error as Error)
        await clearFlowState(userPhoneNumber, config.id)
        return false
      }
    } else if (isKeepAppointmentResponse(userMessage)) {
      logger.info("Usuario decide mantener turno")
      await clearFlowState(userPhoneNumber, config.id)

      // El paciente eligió mantener el turno → se considera confirmada la asistencia
      await markAppointmentConfirmed(userPhoneNumber, config.id, getAppointmentRef(chatbotData))

      const keepMsg = buildKeepAppointmentMessage(chatbotData, flowState.turnoIndex || 0)
      await sendDirectResponse(ctx, keepMsg, "awaiting_cancel_confirmation")

      // Turno se mantiene → volver al menú con el mismo estado de turnos
      const menuAfterKeep = await returnPatientToMenu(userPhoneNumber)
      if (menuAfterKeep) await sendDirectResponse(ctx, menuAfterKeep, "return_to_menu")

      return true
    } else {
      // Respuesta no reconocida como 1/2 - usar NLU contextual si está habilitado
      if (flags.pendingFlowContextualNLU) {
        logger.info("Usando NLU contextual para respuesta no reconocida", { userMessage })
        
        const contextualResult = await handleContextualIntent(
          userMessage,
          flowState,
          chatbotData,
          userPhoneNumber,
          config.id
        )
        
        logger.info("Resultado NLU contextual", {
          intent: contextualResult.detectedIntent,
          action: contextualResult.action,
          confidence: contextualResult.confidence,
        })
        
        // Procesar según la acción determinada
        if (contextualResult.action === "process_as_confirmation") {
          // Tratar como si hubiera dicho "1"
          logger.info("NLU: procesando como confirmación de cancelación")
          // Reusar la lógica de confirmación - llamar recursivamente con "1"
          return handlePendingFlowResponse("1", userPhoneNumber, config, phoneNumberId, value)
        }
        
        if (contextualResult.action === "process_as_rejection") {
          // Tratar como si hubiera dicho "2"
          logger.info("NLU: procesando como rechazo de cancelación")
          return handlePendingFlowResponse("2", userPhoneNumber, config, phoneNumberId, value)
        }
        
        if (contextualResult.action === "maintain_flow_with_response" && contextualResult.contextualResponse) {
          // Enviar respuesta contextual SIN limpiar el estado
          logger.info("NLU: manteniendo flujo con respuesta contextual", {
            intent: contextualResult.detectedIntent,
          })
          await sendDirectResponse(ctx, contextualResult.contextualResponse, "awaiting_cancel_confirmation")
          return true  // Flujo manejado, NO pasar a OpenAI
        }
        
        // action === "abandon_flow" o NLU sin resultado concluyente → re-promptear,
        // nunca abandonar el flujo (evita que el farewell handler u otros capturen el mensaje)
        logger.info("NLU: sin resultado concluyente, re-mostrando prompt de cancelación")
        const retryNluMsg = buildCancelDoubleConfirmMessage(chatbotData, flowState.turnoIndex || 0)
        await sendDirectResponse(ctx, retryNluMsg, "awaiting_cancel_confirmation_retry")
        return true
      }

      // Sin NLU contextual: re-promptear en lugar de pasar a otros handlers.
      // Mantener el flow state para que el próximo mensaje vuelva aquí.
      logger.info("Respuesta no reconocida en awaiting_cancel_confirmation, re-mostrando prompt", { userMessage })
      const retryMsg = buildCancelDoubleConfirmMessage(chatbotData, flowState.turnoIndex || 0)
      await sendDirectResponse(ctx, retryMsg, "awaiting_cancel_confirmation_retry")
      return true
    }
  } else if (flowState.type === 'awaiting_cancel_and_reschedule_confirm') {
    // Menú de 2 opciones mostrado cuando el paciente quiere reagendar con turno activo:
    //   1- Confirmar asistencia al turno médico
    //   2- Cancelar el turno médico y solicitar uno nuevo
    if (!chatbotData) {
      logger.warn("No hay contexto de turno en cancel_and_reschedule, pasando a OpenAI")
      await clearFlowState(userPhoneNumber, config.id)
      return false
    }

    const choice = isCancelAndRescheduleChoice(userMessage)

    if (choice === 'confirm_attendance') {
      // El paciente decidió confirmar asistencia al turno existente.
      // Llamar al proxy PRIMERO (mismo patrón que el flujo de confirmación directo).
      try {
        const turnoAConfirmar = chatbotData.turnos[flowState.turnoIndex || 0]
        const confirmPayload = {
          Cliente_Id: config.cliente_id,
          Action: "confirmar_turno",
          fecha: turnoAConfirmar?.fecha,
          paciente_datos: {
            dni: chatbotData.paciente?.dni,
          },
        }
        logger.info("Enviando confirmacion al proxy (desde menú reagendar)")
        const response = await fetchWithRetry(
          config.proxy,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(confirmPayload),
          },
          TIMEOUTS.PROXY_TIMEOUT,
          { maxRetries: 2, initialDelayMs: 2000, maxDelayMs: 10000, backoffMultiplier: 2 }
        )

        let proxyBody: { success?: boolean; [key: string]: unknown } | null = null
        try {
          const bodyText = await response.text()
          proxyBody = bodyText ? JSON.parse(bodyText) : null
        } catch {
          proxyBody = null
        }

        const proxySuccess = response.ok && proxyBody?.success === true

        await clearFlowState(userPhoneNumber, config.id)

        if (!proxySuccess) {
          logger.error("El proxy no confirmó el turno (menú reagendar)", undefined, {
            httpStatus: response.status,
            body: proxyBody,
          })
          await sendDirectResponse(ctx, "Hubo un problema al confirmar tu turno. Por favor intentá de nuevo en unos momentos.", "cancel_reschedule_confirm_error")
          return true
        }

        await markAppointmentConfirmed(userPhoneNumber, config.id, getAppointmentRef(chatbotData))

        const confirmMsg = buildConfirmationMessage(chatbotData, flowState.turnoIndex || 0)
        await sendDirectResponse(ctx, confirmMsg, "awaiting_cancel_and_reschedule_confirm")

        // Marcar turno como confirmado → volver al menú
        const turnoIdxCR = flowState.turnoIndex || 0
        const updatedTurnosCR = (chatbotData.turnos || []).map((t: any, i: number) =>
          i === turnoIdxCR ? { ...t, Estado: 'Confirmado', estado: 'Confirmado' } : t
        )
        const menuAfterCR = await returnPatientToMenu(userPhoneNumber, updatedTurnosCR, 'just_confirmed')
        if (menuAfterCR) await sendDirectResponse(ctx, menuAfterCR, "return_to_menu")

        return true
      } catch (error) {
        logger.error("Error al confirmar via proxy (menú reagendar)", error as Error)
        await clearFlowState(userPhoneNumber, config.id)
        await sendDirectResponse(ctx, "Hubo un problema al confirmar tu turno. Por favor intentá de nuevo en unos momentos.", "cancel_reschedule_confirm_error")
        return true
      }

    } else if (choice === 'cancel_and_reschedule') {
      // El paciente eligió "Cancelar el turno médico y solicitar uno nuevo".
      // NO cancelamos todavía: primero pedimos doble confirmación de la cancelación
      // (igual que el flujo de cancelación normal). Recién cuando el paciente confirma,
      // el handler de 'awaiting_cancel_confirmation' cancela vía proxy y, gracias a
      // postCancelAction='reschedule', redirige al flujo de reagendamiento.
      const turnoIndex = flowState.turnoIndex || 0
      await setFlowState(userPhoneNumber, config.id, {
        type: 'awaiting_cancel_confirmation',
        createdAt: new Date().toISOString(),
        turnoIndex,
        postCancelAction: 'reschedule',
      })
      const doubleConfirmMsg = buildCancelDoubleConfirmMessage(chatbotData, turnoIndex)
      await sendDirectResponse(ctx, doubleConfirmMsg, "cancel_and_reschedule")
      return true

    } else {
      // Respuesta no reconocida como 1/2 → pasar a OpenAI
      logger.info("Respuesta de cancel_and_reschedule no reconocida, pasando a OpenAI", { userMessage })
      await clearFlowState(userPhoneNumber, config.id)
      return false
    }

  } else if (flowState.type === 'awaiting_reschedule_choice') {
    const choice = isRescheduleChoice(userMessage)
    
    if (choice === 'reschedule') {
      // Para reagendar necesitamos chatbotData; si no está disponible, pasar a OpenAI
      if (!chatbotData) {
        logger.warn("No hay contexto de turno para reagendamiento, pasando a OpenAI")
        await clearFlowState(userPhoneNumber, config.id)
        return false
      }
      logger.info("Usuario quiere reagendar - switch a asistente de reagendamiento")
      await clearFlowState(userPhoneNumber, config.id)
      return {
        type: 'route_to_reagendamiento',
        chatbotData,
        turnoIndex: flowState.turnoIndex || 0
      }
    } else if (choice === 'no_reschedule') {
      // No reagendar: turno fue cancelado previamente → volver al menú sin él
      logger.info("Usuario no quiere reagendar")
      await clearFlowState(userPhoneNumber, config.id)
      const noRescheduleMsg = chatbotData
        ? buildNoRescheduleMessage(chatbotData)
        : buildNoRescheduleMessageFallback()
      await sendDirectResponse(ctx, noRescheduleMsg, "awaiting_reschedule_choice")

      // Remover el turno cancelado del estado y volver al menú
      // El backend cancela todos los turnos del mismo día juntos → filtrar por fecha
      const cancelledIdxNR = flowState.turnoIndex || 0
      const cancelledFechaNR = chatbotData?.turnos?.[cancelledIdxNR]?.fecha
      const remainingAfterNR = chatbotData
        ? (chatbotData.turnos || []).filter((t: any, i: number) => {
            if (i === cancelledIdxNR) return false
            if (cancelledFechaNR && (t.fecha || t.Fecha) === cancelledFechaNR) return false
            return true
          })
        : []
      const menuAfterNR = await returnPatientToMenu(userPhoneNumber, remainingAfterNR, 'just_cancelled')
      if (menuAfterNR) await sendDirectResponse(ctx, menuAfterNR, "return_to_menu")

      return true
    } else {
      // Respuesta no reconocida como 1/2 - usar NLU contextual si está habilitado
      if (flags.pendingFlowContextualNLU) {
        logger.info("Usando NLU contextual para respuesta de reagendamiento no reconocida", { userMessage })
        
        const contextualResult = await handleContextualIntent(
          userMessage,
          flowState,
          chatbotData,
          userPhoneNumber,
          config.id
        )
        
        logger.info("Resultado NLU contextual (reagendamiento)", {
          intent: contextualResult.detectedIntent,
          action: contextualResult.action,
          confidence: contextualResult.confidence,
        })
        
        // Procesar según la acción determinada
        if (contextualResult.action === "process_as_confirmation") {
          // Tratar como si hubiera dicho "1" (reagendar)
          logger.info("NLU: procesando como confirmación de reagendamiento")
          return handlePendingFlowResponse("1", userPhoneNumber, config, phoneNumberId, value)
        }
        
        if (contextualResult.action === "process_as_rejection") {
          // Tratar como si hubiera dicho "2" (no reagendar)
          logger.info("NLU: procesando como rechazo de reagendamiento")
          return handlePendingFlowResponse("2", userPhoneNumber, config, phoneNumberId, value)
        }
        
        if (contextualResult.action === "maintain_flow_with_response" && contextualResult.contextualResponse) {
          // Enviar respuesta contextual SIN limpiar el estado
          logger.info("NLU: manteniendo flujo de reagendamiento con respuesta contextual", {
            intent: contextualResult.detectedIntent,
          })
          await sendDirectResponse(ctx, contextualResult.contextualResponse, "awaiting_reschedule_choice")
          return true
        }
        
        // action === "abandon_flow" o fallback
        logger.info("NLU: abandonando flujo de reagendamiento", { reason: contextualResult.reasoning })
        await clearFlowState(userPhoneNumber, config.id)
        return false
      }
      
      // Sin NLU contextual, comportamiento original
      logger.info("Respuesta de reagendamiento no reconocida, pasando a OpenAI", { userMessage })
      await clearFlowState(userPhoneNumber, config.id)
      return false
    }
  }

  return false
}

// Modificar la función handleMessage para usar la cola por usuario
export async function handleMessage(value: any) {


  try {
    // Verificar si hay mensajes
    if (!value.messages || value.messages.length === 0) {
      console.warn("[WHATSAPP] No se encontraron mensajes en el webhook.")
      return
    }

    // Extraer información del mensaje
    const message = value.messages[0]

    // Verificar si el mensaje ya ha sido procesado
    const messageId = message.id
    if (await isMessageProcessed(messageId)) {
      return
    }

    // Marcar el mensaje como procesado inmediatamente para evitar condiciones de carrera
    await markMessageAsProcessed(messageId)

    const userPhoneNumber = normalizePhoneNumber(message.from)
    const extractedContent = extractMessageContent(message)
    let userMessage = extractedContent.content
    const originalMessage = userMessage
    const audioId = extractedContent.audioId
    const audioMimeType = extractedContent.audioMimeType

    console.info(`[WHATSAPP] Mensaje de ${userPhoneNumber}: "${userMessage.substring(0, 50)}${userMessage.length > 50 ? '...' : ''}" (${message.type})`)

    // Ignorar stickers, reacciones e iconos (mensajes de texto compuestos únicamente por emojis)
    if (message.type === "sticker" || message.type === "reaction") {
      return
    }

    // Ignorar mensajes de texto compuestos únicamente por emojis/iconos.
    // Nota: ️ (variation selector) y ‍ (ZWJ) son parte de secuencias emoji
    // pero NO están cubiertos por \p{Emoji}, por lo que se incluyen explícitamente.
    if (
      message.type === "text" &&
      userMessage &&
      /^[\p{Emoji}\p{Emoji_Presentation}\p{Extended_Pictographic}\u{FE0E}\u{FE0F}\u{200D}\s]+$/u.test(userMessage.trim()) &&
      !/[\p{L}\p{N}]/u.test(userMessage)
    ) {
      return
    }

    // Obtener la configuración de WhatsApp
    const config = await getWhatsAppConfigByPhoneId(value.metadata.phone_number_id)

    if (!config) {
      console.error(
        `[WHATSAPP] Configuración no encontrada para el número de teléfono ID: ${value.metadata.phone_number_id}`,
      )
      return
    }

    // Verificar si es una conversación user-initiated (sin template o fuera de ventana 24h)
    // Solo verificar si hay cliente_id configurado para el tracking de estadísticas
    if (config.cliente_id) {
      await checkAndTrackUserInitiated(config.cliente_id, userPhoneNumber)
    }

    // ============================================================================
    // INTERCEPTOR GLOBAL DE BOTONES DE MENÚ PRINCIPAL
    // Si el usuario presiona un botón del menú principal ("Solicitar turno", "Turno familiar",
    // "Otra consulta") durante CUALQUIER sub-flujo activo, se interrumpe ese flujo y se
    // ejecuta la acción del botón. Detectamos por TÍTULO (no ID) para evitar colisiones.
    // ============================================================================
    if (message.type === "interactive" && message.interactive?.type === "button_reply") {
      const _btnTitle = (message.interactive.button_reply?.title || "").toLowerCase().trim()
      const GLOBAL_MENU_BUTTONS: Record<string, string> = {
        "solicitar turno":    "1",
        "turno para familiar": "2",
        "otra consulta":       "3",
      }
      const globalNumericId = GLOBAL_MENU_BUTTONS[_btnTitle]
      if (globalNumericId) {
        console.log(`[v0] [GLOBAL_BTN] Botón global detectado: "${_btnTitle}" → id="${globalNumericId}"`)
        // Limpiar TODOS los sub-flujos activos
        await clearFlowState(userPhoneNumber, config.id)
        await clearBookingFlowState(userPhoneNumber, config.id)
        await clearExistingPatientFlow(userPhoneNumber)
        await clearNewPatientFlow(userPhoneNumber, config.id)
        // Intentar resetear el flujo de detección al menú principal
        let resetOk = await resetDetectionToMainMenu(userPhoneNumber)
        if (!resetOk) {
          // Estado de detección expirado: restaurar desde caché identified_patient
          resetOk = await restoreDetectionStateFromCache(userPhoneNumber)
        }
        console.log(`[v0] [GLOBAL_BTN] resetOk=${resetOk}, userMessage será "${globalNumericId}"`)
        if (resetOk) {
          // Sobrescribir userMessage con el ID numérico para que el handler de detección lo procese
          userMessage = globalNumericId
        }
        // Si resetOk=false: el bloque SPRINT9A re-detectará al paciente y mostrará el menú
      }
    }

    // ============================================================================
    // INTERCEPTAR RESPUESTAS DE FLUJOS PENDIENTES (doble confirmacion cancelacion, etc)
    // Esto permite responder directamente sin pasar por OpenAI
    // ============================================================================
    if (message.type === "text" || message.type === "button" || message.type === "interactive") {
      // Verificar si hay un flujo pendiente activo antes de invocar el handler,
      // para guardar el mensaje del usuario PRIMERO y así preservar el orden correcto
      // en el monitor de conversaciones (usuario → bot, no bot → usuario).
      const pendingFlowState = await getFlowState(userPhoneNumber, config.id)
      if (pendingFlowState) {
        await saveConversationMessage({
          id: nanoid(),
          role: "user",
          content: userMessage,
          timestamp: new Date().toISOString(),
          phoneNumber: userPhoneNumber,
          configId: config.id,
        })
      }

      const flowResult = await handlePendingFlowResponse(
        userMessage,
        userPhoneNumber,
        config,
        value.metadata.phone_number_id,
        value
      )
      
      // Si fue true, la respuesta fue manejada completamente
      if (flowResult === true) {
        // El mensaje del usuario ya fue guardado antes de llamar a handlePendingFlowResponse
        return
      }
      
      // Si fue un objeto especial (reagendamiento), iniciar el flujo directamente
      if (flowResult && typeof flowResult === 'object' && flowResult.type === 'route_to_reagendamiento') {

        try {
          // Usar turno_cancelado (preservado por clearAppointmentTurnos) como fuente de IDs.
          // Si por algún motivo no existe, intentar fallback a turnos[turnoIndex] (datos legados).
          const turnoCanceladoSnap: ChatbotDataTurnoCancelado | undefined =
            flowResult.chatbotData.turno_cancelado ||
            (flowResult.chatbotData.turnos[flowResult.turnoIndex]
              ? {
                  fecha: flowResult.chatbotData.turnos[flowResult.turnoIndex].fecha,
                  hora: flowResult.chatbotData.turnos[flowResult.turnoIndex].hora,
                  profesional: flowResult.chatbotData.turnos[flowResult.turnoIndex].profesional,
                  profesional_id: flowResult.chatbotData.turnos[flowResult.turnoIndex].profesional_id,
                  sede: flowResult.chatbotData.turnos[flowResult.turnoIndex].sede,
                  sede_id: flowResult.chatbotData.sede_id,
                  direccion: flowResult.chatbotData.turnos[flowResult.turnoIndex].direccion,
                  agenda_id: flowResult.chatbotData.turnos[flowResult.turnoIndex].agenda_id,
                }
              : undefined)

          if (!turnoCanceladoSnap) {
            console.error(`[WHATSAPP] No se encontró turno_cancelado ni turnos[${flowResult.turnoIndex}] para reagendamiento`)
            await sendWhatsAppMessage(
              value.metadata.phone_number_id,
              config.accessToken,
              userPhoneNumber,
              "Lo siento, hubo un error al iniciar el proceso de reagendamiento. Por favor, intentá nuevamente."
            )
            return
          }

          const functionArgs = {
            paciente: {
              nombres: flowResult.chatbotData.paciente.nombres,
              apellido: flowResult.chatbotData.paciente.apellido,
              dni: flowResult.chatbotData.paciente.dni,
              telefono: flowResult.chatbotData.paciente.telefono,
              // Preservar obra social para el resumen de confirmación y la reserva
              obra_social_id: flowResult.chatbotData.paciente.obra_social_id,
              obra_social_nombre: flowResult.chatbotData.paciente.obra_social_nombre,
            },
            turno_cancelado: turnoCanceladoSnap,
          }

          // Encolar el mensaje con flag especial - processIndividualMessage maneja el thread
          await enqueueUserMessage(userPhoneNumber, {
            userMessage: `[SISTEMA_REAGENDAMIENTO]${JSON.stringify(functionArgs)}[/SISTEMA_REAGENDAMIENTO]`,
            messageType: "text",
            phoneNumberId: value.metadata.phone_number_id,
            config,
            audioId: undefined,
            audioMimeType: undefined,
            routeToReagendamiento: true,
            functionArgs,
          })

          return
        } catch (error) {
          console.error(`[WHATSAPP] Error preparando flujo de reagendamiento:`, (error as Error).message)
          await sendWhatsAppMessage(
            value.metadata.phone_number_id,
            config.accessToken,
            userPhoneNumber,
            "Lo siento, hubo un error al iniciar el proceso de reagendamiento. Por favor, intentá nuevamente."
          )
          return
        }
      }
    }

    const activeSession = await getActiveSessionByPhone(config.id, userPhoneNumber)

    if (activeSession) {


      // Guardar el mensaje en el historial de conversación
      await saveConversationMessage({
        id: nanoid(),
        role: "user",
        content: userMessage,
        timestamp: new Date().toISOString(),
        phoneNumber: userPhoneNumber,
        configId: config.id,
      })

      if (activeSession.status === "pending") {
        // Usuario aún esperando asignación - guardar mensaje como pendiente


        await addPendingMessageToSession(activeSession.id, {
          id: nanoid(),
          from: "user",
          content: userMessage,
          timestamp: new Date().toISOString(),
        })

        // Opcional: enviar mensaje de confirmación
        const confirmMessage = "Tu mensaje ha sido recibido. Un agente te responderá pronto."
        await sendWhatsAppMessage(value.metadata.phone_number_id, config.accessToken, userPhoneNumber, confirmMessage)

        await updateWhatsAppStats(config.id, { messagesReceived: 1 })
        return
      } else if (activeSession.status === "in_progress") {
        // Sesión activa con agente - guardar en historial de soporte


        const supportMessage: HumanSupportMessage = {
          id: nanoid(),
          sessionId: activeSession.id,
          role: "user",
          content: userMessage,
          timestamp: new Date().toISOString(),
        }

        await saveSupportMessage(supportMessage)
        await updateWhatsAppStats(config.id, { messagesReceived: 1 })

        // El mensaje se envia al agente a través de WebSocket o polling en la UI
        // No necesitamos enviar respuesta automática aquí
        return
      }
    }
    // </CHANGE>

    // Check if there's a pending human support offer awaiting patient response (Mode C)
    const pendingOffer = await getPendingHumanSupportOffer(config.id, userPhoneNumber)
    if (pendingOffer) {
      const normalized = userMessage.trim()
      if (normalized === "1") {
        // Patient accepted — create session and notify
        await clearPendingHumanSupportOffer(config.id, userPhoneNumber)
        await saveConversationMessage({
          id: nanoid(),
          role: "user",
          content: userMessage,
          timestamp: new Date().toISOString(),
          phoneNumber: userPhoneNumber,
          configId: config.id,
        })
        try {
          await createSupportSession({
            phoneNumber: userPhoneNumber,
            configId: pendingOffer.configId,
            tenantId: pendingOffer.tenantId,
            threadId: pendingOffer.threadId,
            assistantId: pendingOffer.assistantId,
            displayName: pendingOffer.displayName,
            reason: pendingOffer.reason,
            priority: pendingOffer.priority,
            summary: pendingOffer.summary,
          })
          const confirmMsg = `Hemos derivado la conversación a atención humana de ${pendingOffer.displayName || "la clínica"}. En unos instantes serás atendido.`
          await sendWhatsAppMessage(pendingOffer.phoneNumberId, pendingOffer.accessToken, userPhoneNumber, confirmMsg)
        } catch (err) {
          console.error("[WHATSAPP] Error creando sesión desde oferta:", err)
        }
        await updateWhatsAppStats(config.id, { messagesReceived: 1 })
        return
      } else if (normalized === "2") {
        // Patient declined — clear offer and let them continue with AI
        await clearPendingHumanSupportOffer(config.id, userPhoneNumber)
        await saveConversationMessage({
          id: nanoid(),
          role: "user",
          content: userMessage,
          timestamp: new Date().toISOString(),
          phoneNumber: userPhoneNumber,
          configId: config.id,
        })
        const declineMsg = "Entendido. Seguís con el asistente virtual. Si necesitás algo más, avisame."
        await sendWhatsAppMessage(pendingOffer.phoneNumberId, pendingOffer.accessToken, userPhoneNumber, declineMsg)
        await updateWhatsAppStats(config.id, { messagesReceived: 1 })
        return
      } else {
        // Unrecognized response — re-send the offer
        await saveConversationMessage({
          id: nanoid(),
          role: "user",
          content: userMessage,
          timestamp: new Date().toISOString(),
          phoneNumber: userPhoneNumber,
          configId: config.id,
        })
        const reOfferMsg =
          `Por favor elegí una opción:\n\n` +
          `1. Sí, quiero atención humana\n` +
          `2. No, gracias`
        await sendWhatsAppMessage(pendingOffer.phoneNumberId, pendingOffer.accessToken, userPhoneNumber, reOfferMsg)
        await updateWhatsAppStats(config.id, { messagesReceived: 1 })
        return
      }
    }

    const conversationPaused = await isConversationPaused(config.id, userPhoneNumber)
    if (conversationPaused) {

      await updateWhatsAppStats(config.id, { messagesReceived: 1 })
      // Guardar el mensaje aunque la IA esté pausada para mantener el historial
      await saveConversationMessage({
        id: nanoid(),
        role: "user",
        content: userMessage,
        timestamp: new Date().toISOString(),
        phoneNumber: userPhoneNumber,
        configId: config.id,
      })
      return
    }

    await saveConversationMessage({
      id: nanoid(),
      role: "user",
      content: userMessage,
      timestamp: new Date().toISOString(),
      phoneNumber: userPhoneNumber,
      configId: config.id,
    })

    // Guardar en historial conversacional (fire-and-forget, no bloquea el flujo)
    appendToHistory(userPhoneNumber, { role: 'user', text: userMessage, timestamp: Date.now() }).catch(() => {})

    if (message.type === "button" && message.button) {
      // Detectar si es un botón de cancelación
      const buttonText = (message.button.text || "").toLowerCase()
      const buttonPayload = (message.button.payload || "").toLowerCase()
      const isCancellationButton = buttonText.includes("cancelar") || buttonPayload.includes("cancel")
      
      // IMPORTANTE: Limpiar el assistantId del thread para volver al asistente principal
      // Esto es necesario porque las respuestas de botón vienen de templates externos (recordatorios)
      // y no deben ser procesadas por asistentes especializados (ej: agendamiento)
      await clearThreadAssistantId(userPhoneNumber, config.id)

      // Si es cancelación, intentar respuesta directa primero
      if (isCancellationButton) {
        // Intentar respuesta directa con datos del contexto guardado
        const chatbotData = await getAppointmentContext(userPhoneNumber, config.id)
        
        if (chatbotData) {
          
          // Setear estado de flujo para esperar confirmacion
          await setFlowState(userPhoneNumber, config.id, {
            type: 'awaiting_cancel_confirmation',
            createdAt: new Date().toISOString(),
            turnoIndex: 0
          })
          
          // Construir y enviar mensaje de doble confirmacion
          const ctx: DirectResponseContext = {
            phoneNumberId: value.metadata.phone_number_id,
            accessToken: config.accessToken,
            userPhoneNumber,
            configId: config.id,
            clienteId: config.cliente_id,
          }
          
          const doubleConfirmMsg = buildCancelDoubleConfirmMessage(chatbotData, 0)
          const sent = await sendDirectResponse(ctx, doubleConfirmMsg)
          
          if (sent) {
            return // Salir, no pasar a OpenAI
          } else {
            await clearFlowState(userPhoneNumber, config.id)
          }
        }
        
        // Fallback: Crear mensaje para el chatbot con la solicitud de cancelación
        userMessage = `El paciente presionó el botón "${originalMessage}" solicitando cancelar su turno.

[SOLICITUD_CANCELACION]
Accion: El paciente ha presionado el botón de cancelaci��n
Boton_Texto: ${message.button.text}
Boton_Payload: ${message.button.payload}
Timestamp: ${new Date().toISOString()}
[/SOLICITUD_CANCELACION]

IMPORTANTE: El turno NO ha sido cancelado todavía. Busca en el historial de la conversación la información del turno que fue enviada previamente en un bloque [SISTEMA_PLANTILLA] para proporcionar los detalles específicos del turno. Pregunta al paciente si está seguro de querer cancelar, mostrando los detalles del turno.`
        
        // Continuar con el flujo normal del chatbot (no hacer nada más aquí)
      } else {
        // Para confirmación y reprogramación, mantener el flujo actual al proxy
        let proxyResponse = null
      try {
        const proxyPayload = {
          action: "template_response",
          Cliente_Id: config.cliente_id,
          Phone_Number_Id: value.metadata.phone_number_id,
          ...value, // Enviar toda la estructura de WhatsApp
        }

        const response = await fetchWithRetry(
          `${config.proxy}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(proxyPayload),
          },
          TIMEOUTS.PROXY_TIMEOUT,
          {
            maxRetries: 3,
            initialDelayMs: 3000,
            maxDelayMs: 15000,
            backoffMultiplier: 2,
          },
        )

        if (response.ok) {
          const responseText = await response.text()

          // Parsear la respuesta del proxy para enviarla a OpenAI
          try {
            proxyResponse = JSON.parse(responseText)
          } catch (parseError) {
            console.error(`[WHATSAPP] Error al parsear respuesta del proxy:`, parseError)
            proxyResponse = { success: false, error: "PARSE_ERROR", raw: responseText }
          }
        } else {
          const errorText = await response.text()
          console.error(`[WHATSAPP] Error del proxy: ${response.status} - ${errorText}`)
          proxyResponse = { success: false, error: "PROXY_ERROR", status: response.status, message: errorText }
        }
      } catch (error) {
        console.error(`[WHATSAPP] Error al enviar respuesta de botón al proxy:`, error)
        proxyResponse = { success: false, error: "NETWORK_ERROR", message: (error as Error).message }
      }

      // Modificar el mensaje para incluir la respuesta del proxy de forma más específica
      if (proxyResponse) {

        if (proxyResponse.success) {
          // Si el proxy responde exitosamente
          if (proxyResponse.action_type) {
            const templateSentAt = config.cliente_id
              ? await getTemplateSentTime(config.cliente_id, userPhoneNumber)
              : null

            // Usar la información específica del proxy para crear el mensaje
            switch (proxyResponse.action_type) {
              case "confirmacion_turno":
                if (config.cliente_id) {
                  await trackAppointmentEvent({
                    clienteId: config.cliente_id,
                    phoneNumber: userPhoneNumber,
                    eventType: "confirmed",
                    timestamp: new Date().toISOString(),
                    templateSentAt: templateSentAt || undefined,
                    metadata: { proxyResponse },
                  })
                }

                // Intentar respuesta directa con datos del contexto guardado
                const chatbotDataConfirm = await getAppointmentContext(userPhoneNumber, config.id)
                // Marcar el turno como confirmado para no volver a ofrecer "Confirmar asistencia"
                await markAppointmentConfirmed(userPhoneNumber, config.id, getAppointmentRef(chatbotDataConfirm))
                if (chatbotDataConfirm) {
                  
                  const ctxConfirm: DirectResponseContext = {
                    phoneNumberId: value.metadata.phone_number_id,
                    accessToken: config.accessToken,
                    userPhoneNumber,
                    configId: config.id,
                    clienteId: config.cliente_id,
                  }
                  
                  const confirmMsg = buildConfirmationMessage(chatbotDataConfirm, 0)
                  const sentConfirm = await sendDirectResponse(ctxConfirm, confirmMsg)

                  if (sentConfirm) {
                    // Marcar turno como confirmado y volver al menú si hay estado activo
                    const updatedTurnosTemplate = (chatbotDataConfirm.turnos || []).map((t: any, i: number) =>
                      i === 0 ? { ...t, Estado: 'Confirmado', estado: 'Confirmado' } : t
                    )
                    const menuAfterTemplate = await returnPatientToMenu(userPhoneNumber, updatedTurnosTemplate, 'just_confirmed')
                    if (menuAfterTemplate) await sendDirectResponse(ctxConfirm, menuAfterTemplate, "return_to_menu")

                    return // Salir, no pasar a OpenAI
                  }
                }

                // Fallback a OpenAI
                userMessage = `El paciente confirmó su turno presionando "${originalMessage}".

[CONFIRMACION_TURNO_EXITOSA]
Accion: Confirmación de turno
Estado: ${proxyResponse.status}
Mensaje: ${proxyResponse.message}
Instrucciones: ${proxyResponse.next_steps}
Timestamp: ${proxyResponse.timestamp}
[/CONFIRMACION_TURNO_EXITOSA]

IMPORTANTE: Busca en el historial de la conversación la información del turno que fue enviada previamente en un bloque [SISTEMA_PLANTILLA] para proporcionar los detalles específicos del turno confirmado (fecha, hora, profesional, lugar).`
                break

      case "cancelacion_turno":
        if (config.cliente_id) {
          await trackAppointmentEvent({
            clienteId: config.cliente_id,
            phoneNumber: userPhoneNumber,
            eventType: "cancelled",
            timestamp: new Date().toISOString(),
            templateSentAt: templateSentAt || undefined,
            metadata: { proxyResponse },
          })
          
          // Marcar que hay una cancelación pendiente de reagendar (ventana de 12h)
          await markPendingReschedule(config.cliente_id, userPhoneNumber)

        }

                userMessage = `El paciente canceló su turno presionando "${originalMessage}".

[CANCELACION_TURNO_EXITOSA]
Accion: Cancelación de turno
Estado: ${proxyResponse.status}
Mensaje: ${proxyResponse.message}
Instrucciones: ${proxyResponse.next_steps}
Timestamp: ${proxyResponse.timestamp}
[/CANCELACION_TURNO_EXITOSA]

IMPORTANTE: Busca en el historial de la conversación la información del turno que fue enviada previamente en un bloque [SISTEMA_PLANTILLA] para proporcionar los detalles específicos del turno cancelado.`
                break

              case "reprogramacion_turno":
                if (config.cliente_id) {
                  await trackAppointmentEvent({
                    clienteId: config.cliente_id,
                    phoneNumber: userPhoneNumber,
                    eventType: "rescheduled",
                    timestamp: new Date().toISOString(),
                    templateSentAt: templateSentAt || undefined,
                    metadata: { proxyResponse },
                  })

                }

                userMessage = `El paciente solicitó reprogramar su turno presionando "${originalMessage}".

[REPROGRAMACION_TURNO_SOLICITADA]
Accion: Reprogramación de turno
Estado: ${proxyResponse.status}
Mensaje: ${proxyResponse.message}
Instrucciones: ${proxyResponse.next_steps}
Timestamp: ${proxyResponse.timestamp}
[/REPROGRAMACION_TURNO_SOLICITADA]

IMPORTANTE: Busca en el historial de la conversación la información del turno que fue enviada previamente en un bloque [SISTEMA_PLANTILLA] para proporcionar los detalles específicos del turno a reprogramar.`
                break

              default:
                userMessage = `El paciente respondió "${originalMessage}" a una plantilla.

[RESPUESTA_BOTON_PROCESADA]
Accion: ${proxyResponse.action_type}
Estado: ${proxyResponse.status || "procesado"}
Mensaje: ${proxyResponse.message || "Respuesta procesada exitosamente"}
Instrucciones: ${proxyResponse.next_steps || "Continuar con la conversación normal"}
Timestamp: ${proxyResponse.timestamp || new Date().toISOString()}
[/RESPUESTA_BOTON_PROCESADA]

Responde de manera apropiada según la acción realizada.`
            }
          } else {
            // Si success es true pero no hay action_type específico
            const buttonTextLower = originalMessage.toLowerCase()
            const accionDetectada = buttonTextLower.includes("confirmar")
              ? "confirmacion"
              : buttonTextLower.includes("cancelar")
                ? "cancelacion"
                : buttonTextLower.includes("reprogramar") || buttonTextLower.includes("reagendar")
                  ? "reprogramacion"
                  : "respuesta_generica"

            if (config.cliente_id) {
              const templateSentAt = await getTemplateSentTime(config.cliente_id, userPhoneNumber)

              let eventType: "confirmed" | "cancelled" | "rescheduled"
              if (accionDetectada === "confirmacion") {
                eventType = "confirmed"
              } else if (accionDetectada === "cancelacion") {
                eventType = "cancelled"
                // Marcar que hay una cancelación pendiente de reagendar (ventana de 12h)
                await markPendingReschedule(config.cliente_id, userPhoneNumber)
              } else {
                eventType = "rescheduled"
              }

              try {
                await trackAppointmentEvent({
                  clienteId: config.cliente_id,
                  phoneNumber: userPhoneNumber,
                  eventType: eventType,
                  timestamp: new Date().toISOString(),
                  templateSentAt: templateSentAt || undefined,
                  metadata: {
                    source: "proxy_simple_response",
                    buttonText: originalMessage,
                    proxyResponse,
                  },
                })
                
                // Si es confirmación, intentar respuesta directa si el flag está activo
                if (eventType === "confirmed") {
                  const confirmFlags = await getEffectiveFeatureFlags(config.id)
                  const confirmLogger = createConversationLogger(userPhoneNumber, config.id, "awaiting_confirmation")

                  // Marcar el turno como confirmado para no volver a ofrecer "Confirmar asistencia"
                  const chatbotDataForMark = await getAppointmentContext(userPhoneNumber, config.id)
                  await markAppointmentConfirmed(userPhoneNumber, config.id, getAppointmentRef(chatbotDataForMark))

                  if (confirmFlags.directConfirmation) {
                    const chatbotDataSimple = await getAppointmentContext(userPhoneNumber, config.id)
                    if (chatbotDataSimple) {
                      confirmLogger.info("Usando respuesta directa para confirmacion (sin action_type)")
                      const ctxSimple: DirectResponseContext = {
                        phoneNumberId: value.metadata.phone_number_id,
                        accessToken: config.accessToken,
                        userPhoneNumber,
                        configId: config.id,
                        clienteId: config.cliente_id,
                      }
                      const confirmMsgSimple = buildConfirmationMessage(chatbotDataSimple, 0)
                      const sentSimple = await sendDirectResponse(ctxSimple, confirmMsgSimple, "awaiting_confirmation")
                      if (sentSimple) {
                        confirmLogger.info("Confirmacion enviada directamente, saliendo de OpenAI")
                        // Marcar turno como confirmado y volver al menú si hay estado activo
                        const updatedTurnosSimple = (chatbotDataSimple.turnos || []).map((t: any, i: number) =>
                          i === 0 ? { ...t, Estado: 'Confirmado', estado: 'Confirmado' } : t
                        )
                        const menuAfterSimple = await returnPatientToMenu(userPhoneNumber, updatedTurnosSimple, 'just_confirmed')
                        if (menuAfterSimple) await sendDirectResponse(ctxSimple, menuAfterSimple, "return_to_menu")
                        return
                      }
                    } else {
                      // No hay Chatbot_Data — usar info del template tracking para
                      // responder directamente sin nombre del paciente (evita usar
                      // el apellido del médico como nombre del paciente).
                      const trackingData = await getTemplateTrackingData(config.cliente_id, userPhoneNumber)
                      if (trackingData?.appointmentInfo) {
                        confirmLogger.info("Sin chatbotData — usando appointmentInfo del template tracking para respuesta directa")
                        const ctxNoData: DirectResponseContext = {
                          phoneNumberId: value.metadata.phone_number_id,
                          accessToken: config.accessToken,
                          userPhoneNumber,
                          configId: config.id,
                          clienteId: config.cliente_id,
                        }
                        const msgNoData = buildConfirmationMessageNoName(trackingData.appointmentInfo)
                        const sentNoData = await sendDirectResponse(ctxNoData, msgNoData, "awaiting_confirmation_no_chatbot_data")
                        if (sentNoData) {
                          confirmLogger.info("Confirmacion enviada directamente (sin chatbotData)")
                          return
                        }
                      }
                      confirmLogger.warn("directConfirmation ON pero no hay chatbotData ni trackingData, pasando a OpenAI")
                    }
                  } else {
                    confirmLogger.info("directConfirmation flag OFF, pasando a OpenAI")
                  }
                }
              } catch (trackError) {
                console.error(`[WHATSAPP] Error al registrar evento de estadísticas:`, trackError)
              }
            }

            userMessage = `El paciente respondió "${originalMessage}" a una plantilla.

[RESPUESTA_BOTON_PROCESADA]
Accion: ${accionDetectada}
Estado: procesado
Mensaje: Respuesta "${originalMessage}" procesada exitosamente por el proxy
Instrucciones: Seguir las reglas específicas del system prompt para respuestas de tipo "${accionDetectada}"
Timestamp: ${new Date().toISOString()}
[/RESPUESTA_BOTON_PROCESADA]

IMPORTANTE: Si es una confirmación o cancelación, busca en el historial de la conversación la información del turno que fue enviada previamente en un bloque [SISTEMA_PLANTILLA] para proporcionar los detalles específicos del turno.`
          }
        } else {
          // Si hay error en el proxy, manejar casos específicos
          const errorType = proxyResponse.error
          const userAction = proxyResponse.user_action || originalMessage

          if (errorType === "NOT_FOUND") {
            const notFoundLogger = createConversationLogger(userPhoneNumber, config.id, "not_found")
            notFoundLogger.warn("Error NOT_FOUND detectado, enviando mensaje directo sin OpenAI")

            // Intentar usar el contexto del turno para un mensaje más específico
            const chatbotDataNotFound = await getAppointmentContext(userPhoneNumber, config.id)
            const isConfirmButton = isCancellationButton === false && originalMessage === "Confirmar"

            let notFoundMessage: string
            if (chatbotDataNotFound && isConfirmButton) {
              notFoundLogger.info("Turno ya cancelado, usando mensaje especifico")
              notFoundMessage = buildAlreadyCancelledMessage(chatbotDataNotFound, 0)
            } else {
              notFoundMessage =
                "Lo siento, esta acción ya no está disponible. Es posible que el turno ya haya sido procesado o que la solicitud haya expirado. Si necesitas ayuda, por favor escribime tu consulta."
            }

            try {
              await saveConversationMessage({
                id: nanoid(),
                role: "assistant",
                content: notFoundMessage,
                timestamp: new Date().toISOString(),
                phoneNumber: userPhoneNumber,
                configId: config.id,
                messageType: "error",
              })
            } catch (saveError) {
              notFoundLogger.error("Error guardando mensaje de error", saveError as Error)
            }

            try {
              await sendWhatsAppMessage(
                value.metadata.phone_number_id,
                config.accessToken,
                userPhoneNumber,
                notFoundMessage,
              )
              await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
              notFoundLogger.info("Mensaje NOT_FOUND enviado exitosamente")
              return
            } catch (sendError) {
              notFoundLogger.error("Error al enviar mensaje NOT_FOUND", sendError as Error)
            }
          }

          // Tratar ALREADY_CONFIRMED como éxito aunque venga con success: false
          let templateSentAt: string | null | undefined = undefined
          if (config.cliente_id) {
            templateSentAt = await getTemplateSentTime(config.cliente_id, userPhoneNumber)
          }

          if (errorType === "ALREADY_CONFIRMED") {

            if (config.cliente_id) {
              await trackAppointmentEvent({
                clienteId: config.cliente_id,
                phoneNumber: userPhoneNumber,
                eventType: "confirmed",
                timestamp: new Date().toISOString(),
                templateSentAt: templateSentAt || undefined,
                metadata: { proxyResponse },
              })
            }
            // El turno ya estaba confirmado: marcarlo para no volver a ofrecer "Confirmar asistencia"
            const chatbotDataAlreadyConfirmed = await getAppointmentContext(userPhoneNumber, config.id)
            await markAppointmentConfirmed(userPhoneNumber, config.id, getAppointmentRef(chatbotDataAlreadyConfirmed))
          }

          switch (errorType) {
            case "CANNOT_CANCEL":
              userMessage = `El paciente intentó cancelar su turno presionando "${userAction}" pero no es posible.

[ERROR_ESTADO_TURNO]
Accion_Solicitada: Cancelación
Error: ${errorType}
Mensaje: ${proxyResponse.message || "No se puede cancelar un turno que ya fue confirmado"}
Razon: El turno ya fue confirmado y no puede ser cancelado por este medio
Solucion_Sugerida: Contactar directamente con la clínica
[/ERROR_ESTADO_TURNO]

Explica que no se puede cancelar un turno ya confirmado y que debe contactar a la clínica si cometió un error.`
              break

            case "CANNOT_CONFIRM":
              userMessage = `El paciente intentó confirmar su turno presionando "${userAction}" pero no es posible.

[ERROR_ESTADO_TURNO]
Accion_Solicitada: Confirmación
Error: ${errorType}
Mensaje: ${proxyResponse.message || "No se puede confirmar un turno que ya fue cancelado"}
Razon: El turno ya fue cancelado y no puede ser confirmado por este medio
Solucion_Sugerida: Contactar directamente con la clínica
[/ERROR_ESTADO_TURNO]

Explica que no se puede confirmar un turno ya cancelado y que debe contactar a la clínica si cometió un error.`
              break

            case "TURNO_EXPIRED":
              userMessage = `El paciente intentó gestionar su turno presionando "${userAction}" pero el turno ya expiró.

[ERROR_ESTADO_TURNO]
Accion_Solicitada: ${userAction}
Error: ${errorType}
Mensaje: ${proxyResponse.message || "El turno ya expiró"}
Razon: El turno ya pasó la fecha/hora programada
Solucion_Sugerida: Contactar directamente con la clínica para reagendar
[/ERROR_ESTADO_TURNO]

Explica que el turno ya expiró y que debe contactar a la clínica para reagendar.`
              break

            case "ALREADY_CONFIRMED":
              // Tratar como éxito - el turno ya estaba confirmado
              if (config.cliente_id) {
                await trackAppointmentEvent({
                  clienteId: config.cliente_id,
                  phoneNumber: userPhoneNumber,
                  eventType: "confirmed",
                  timestamp: new Date().toISOString(),
                  templateSentAt: templateSentAt || undefined,
                  metadata: { proxyResponse },
                })
              }

              userMessage = `El paciente presionó "${originalMessage}" para confirmar su turno.

[CONFIRMACION_TURNO_EXITOSA]
Accion: Confirmación de turno
Estado: ALREADY_CONFIRMED
Mensaje: El turno ya estaba confirmado previamente
Instrucciones: El turno ya se encuentra confirmado en el sistema
Timestamp: ${new Date().toISOString()}
[/CONFIRMACION_TURNO_EXITOSA]

IMPORTANTE: Busca en el historial de la conversación la información del turno que fue enviada previamente en un bloque [SISTEMA_PLANTILLA] para proporcionar los detalles específicos del turno confirmado (fecha, hora, profesional, lugar). Informa al paciente que su turno ya estaba confirmado en el sistema.`
              break

            default:
              // Error genérico
              userMessage = `El paciente presionó "${originalMessage}" pero hubo un error en el procesamiento.

[ERROR_PROCESAMIENTO_BOTON]
Accion: ${originalMessage}
Estado: Error
Error: ${JSON.stringify(proxyResponse)}
[/ERROR_PROCESAMIENTO_BOTON]

Informa que hubo un problema técnico y ofrece alternativas de contacto.`
          }
        }
      }
      } // Cierre del else (flujo proxy para confirmación/reprogramación)
    }

    // Comandos especiales
    if (userMessage.toLowerCase() === "tree reset") {
      try {
        // 1. Resetear el thread de OpenAI
        await resetThreadForUser(userPhoneNumber, config.id)

        // 2. Limpiar TODOS los estados de conversación en Redis
        const clearResult = await clearAllConversationStates(userPhoneNumber, config.id)
        if (clearResult.errors.length > 0) {
          console.warn(`[WHATSAPP] Errores al limpiar estados: ${clearResult.errors.join(', ')}`)
        }

        // Enviar mensaje de confirmación
        await sendWhatsAppMessage(
          value.metadata.phone_number_id,
          config.accessToken,
          userPhoneNumber,
          "✅ Conversación reiniciada exitosamente.",
        )

        // Actualizar estadísticas - mensaje procesado
        await updateWhatsAppStats(config.id, { messagesProcessed: 1 })

        return // Importante: salir de la función después de procesar el reset
      } catch (error) {
        console.error("[WHATSAPP] Error al resetear conversación:", error)

        const errorMessage = "❌ No se pudo reiniciar la conversación. Por favor, intenta de nuevo."

        try {
          await saveConversationMessage({
            id: nanoid(),
            role: "assistant",
            content: errorMessage,
            timestamp: new Date().toISOString(),
            phoneNumber: userPhoneNumber,
            configId: config.id,
            messageType: "error",
          })
        } catch (saveError) {
          console.error(`[WHATSAPP] Error guardando mensaje de error de reset:`, saveError)
        }
        // </CHANGE>

        await sendWhatsAppMessage(value.metadata.phone_number_id, config.accessToken, userPhoneNumber, errorMessage)

        // Actualizar estadísticas - error
        await updateWhatsAppStats(config.id, { errors: 1 })

        return // Salir de la función después de manejar el error
      }
    }

    // ============================================================================
    // INTERCEPTAR DNI (Sprint 5: Extracción y Validación de DNI)
    // Si hay un estado awaiting_dni activo, validar directamente sin OpenAI
    // ============================================================================
    if (message.type === "text") {
      const dniFlags = await getEffectiveFeatureFlags(config.id)
      if (dniFlags.directDNIExtraction) {
        const dniResult = await handleDNIIfAwaiting(userMessage, userPhoneNumber, config.id)
        if (dniResult.handled) {
          const dniLogger = createConversationLogger(userPhoneNumber, config.id, "awaiting_dni")
          const dniCtx: DirectResponseContext = {
            phoneNumberId: value.metadata.phone_number_id,
            accessToken: config.accessToken,
            userPhoneNumber,
            configId: config.id,
            clienteId: config.cliente_id,
          }

          if (dniResult.type === "invalid_dni") {
            // DNI inválido: responder con mensaje de error y esperar nuevo intento
            dniLogger.warn("DNI invalido interceptado, enviando mensaje de error", {
              attemptsLeft: dniResult.attemptsLeft,
            })
            await sendDirectResponse(dniCtx, dniResult.errorMessage, "awaiting_dni")
            return
          }

          if (dniResult.type === "valid_dni") {
            // DNI válido: loguear y dejar continuar a OpenAI con el DNI ya extraído
            // Inyectamos el DNI normalizado en el mensaje para que OpenAI lo procese correctamente
            dniLogger.info("DNI valido extraido por backend, pasando a OpenAI con DNI normalizado", {
              dni: dniResult.dni,
            })
            // Reemplazar el mensaje original por el DNI normalizado para que OpenAI no tenga que extraerlo
            userMessage = dniResult.dni
            // Continuar a OpenAI con el DNI limpio
          }
        }
      }
    }

    // ============================================================================
    // SPRINT 15: INTERCEPTAR RESPUESTAS RECIPROCAS A DESPEDIDAS (SILENCIO)
    // Detecta "Igualmente", "Vos también", etc. después de una despedida del bot
    // En estos casos NO respondemos nada - silencio total
    // IMPORTANTE: Ejecutar PRIMERO porque si el usuario solo dice "igualmente"
    // no queremos iniciar ningún flujo
    // ============================================================================
    if (message.type === "text") {
      const reciprocalFlags = await getEffectiveFeatureFlags(config.id)
      
      if (reciprocalFlags.reciprocalFarewellSilence) {
        const reciprocalResult = await detectReciprocalFarewellPreFlow(
          userMessage,
          userPhoneNumber,
          config.id
        )
        
        if (reciprocalResult.shouldSilence) {

          // Verificar si hay un recordatorio pendiente de respuesta.
          // Si el paciente todavía no confirmó ni canceló su turno, NO silenciar:
          // el Sprint 14 debe tener la oportunidad de pedir la confirmación explícita.
          let hasPendingReminder = false
          if (config.cliente_id) {
            const templateSentAt = await getTemplateSentTime(config.cliente_id, userPhoneNumber)
            hasPendingReminder = templateSentAt !== null
          }

          if (!hasPendingReminder) {
            // Trackear evento para analytics
            await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
            // NO enviar ninguna respuesta - silencio total
            return
          }
          // Si hay reminder pendiente → caer al Sprint 14 para pedir confirmación
          console.info("[SPRINT-15] Reminder pendiente detectado, omitiendo silencio para obtener confirmación del turno")
        }
      }
    }

    // ============================================================================
    // SPRINT 14: INTERCEPTAR CONFIRMACION/CANCELACION DIRECTA (PRIORIDAD ALTA)
    // Detecta "Confirmo", "Cancelo", "Voy", "No puedo", etc. por texto libre
    // cuando hay un template reciente (ventana 24h) pero sin flowState pendiente
    // IMPORTANTE: Ejecutar ANTES de despedida porque "La confirmo. Gracias" contiene "Gracias"
    // ============================================================================
    if (message.type === "text") {
      const directConfirmFlags = await getEffectiveFeatureFlags(config.id)
      
      if (directConfirmFlags.directConfirmCancelDetection && config.cliente_id) {
  
        
        const directActionResult = await detectDirectConfirmationPreFlow(
          userPhoneNumber,
          config.id,
          config.cliente_id,
          userMessage,
          true // useNLU habilitado
        )
        
        if (directActionResult.detected && directActionResult.appointmentContext) {
          const appointmentCtx = directActionResult.appointmentContext as ChatbotData
          const patientName = appointmentCtx.paciente?.nombres || "Estimado/a"
          
          if (directActionResult.action === "confirm") {
            
            const confirmCtx: DirectResponseContext = {
              phoneNumberId: value.metadata.phone_number_id,
              accessToken: config.accessToken,
              userPhoneNumber,
              configId: config.id,
              clienteId: config.cliente_id,
            }

            // appointment_id se conserva para trackeo de eventos
            const appointmentId = appointmentCtx.appointment_id
              || (Array.isArray(appointmentCtx.turnos) && appointmentCtx.turnos[0]?.agenda_id)
              || null
            const tieneProxy = !!config.proxy
            const tieneFecha = !!(Array.isArray(appointmentCtx.turnos) && appointmentCtx.turnos[0]?.fecha)
            const tieneDni = !!appointmentCtx.paciente?.dni

            if (!tieneProxy || !tieneFecha || !tieneDni) {
              console.warn("[PROXY] Confirmacion de turno omitida — datos insuficientes", {
                tieneProxy,
                tieneFecha,
                tieneDni,
              })
              await sendDirectResponse(confirmCtx, "No pudimos confirmar tu turno en este momento. Por favor intentá de nuevo en unos minutos.", "direct_confirm_error")
              await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
              return
            }

            // Llamar al proxy PRIMERO — el mensaje al usuario depende de la respuesta
            try {
              const turnoAConfirmar = Array.isArray(appointmentCtx.turnos) && appointmentCtx.turnos[0]
              const confirmPayload = {
                Cliente_Id: config.cliente_id,
                Action: "confirmar_turno",
                fecha: turnoAConfirmar?.fecha,
                paciente_datos: {
                  dni: appointmentCtx.paciente?.dni,
                },
              }
              console.info("[PROXY] Enviando confirmacion de turno", {
                url: config.proxy,
                payload: confirmPayload,
              })
              const confirmProxyResponse = await fetchWithRetry(
                config.proxy,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(confirmPayload),
                },
                TIMEOUTS.PROXY_TIMEOUT,
                { maxRetries: 2, initialDelayMs: 2000, maxDelayMs: 10000, backoffMultiplier: 2 }
              )
              let confirmProxyBody: { success?: boolean; [key: string]: unknown } | null = null
              let confirmProxyBodyText = ""
              try {
                confirmProxyBodyText = await confirmProxyResponse.text()
                confirmProxyBody = confirmProxyBodyText ? JSON.parse(confirmProxyBodyText) : null
              } catch {
                confirmProxyBody = null
              }
              console.info("[PROXY] Respuesta confirmacion de turno", {
                httpStatus: confirmProxyResponse.status,
                ok: confirmProxyResponse.ok,
                body: confirmProxyBody,
              })

              const proxySuccess = confirmProxyResponse.ok && confirmProxyBody?.success === true

              if (!proxySuccess) {
                console.error("[PROXY] El proxy no confirmó el turno", {
                  httpStatus: confirmProxyResponse.status,
                  body: confirmProxyBody,
                })
                await sendDirectResponse(confirmCtx, "Hubo un problema al confirmar tu turno. Por favor intentá de nuevo en unos momentos.", "direct_confirm_proxy_error")
                await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
                return
              }

              // Proxy confirmó con éxito — recién ahora enviamos el mensaje al usuario
              const confirmResponse = buildConfirmationMessage(appointmentCtx, 0)
              await sendDirectResponse(confirmCtx, confirmResponse, "direct_confirm")

              // Marcar el turno como confirmado para no volver a ofrecer "Confirmar asistencia"
              await markAppointmentConfirmed(userPhoneNumber, config.id, getAppointmentRef(appointmentCtx))

              // Trackear evento
              await trackAppointmentEvent({
                clienteId: config.cliente_id,
                phoneNumber: userPhoneNumber,
                eventType: "template_confirmed",
                timestamp: new Date().toISOString(),
                appointmentId: String(appointmentId),
                metadata: { method: "direct_text" },
              })
            } catch (proxyError) {
              console.error("[PROXY] Error enviando confirmacion al proxy:", proxyError)
              await sendDirectResponse(confirmCtx, "Hubo un problema al confirmar tu turno. Por favor intentá de nuevo en unos momentos.", "direct_confirm_exception")
            }
            
            await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
            return
          }
          
          if (directActionResult.action === "cancel") {
            
            // Construir detalles del turno para el mensaje
            const turnoDetails = appointmentCtx.turno 
              ? `📅 ${appointmentCtx.turno.fecha} a las ${appointmentCtx.turno.hora}\n👨‍⚕️ ${appointmentCtx.turno.profesional}\n�� ${appointmentCtx.turno.sede}`
              : "Tu turno programado"
            
            const cancelPrompt = buildCancelConfirmationPrompt(patientName, turnoDetails)
            
            const cancelCtx: DirectResponseContext = {
              phoneNumberId: value.metadata.phone_number_id,
              accessToken: config.accessToken,
              userPhoneNumber,
              configId: config.id,
              clienteId: config.cliente_id,
            }
            
            // Establecer flowState para esperar la doble confirmación
            await setFlowState(userPhoneNumber, config.id, {
              state: "awaiting_cancel_confirmation",
              appointmentId: String(appointmentCtx.appointment_id),
              patientName,
              timestamp: Date.now(),
            })
            
            await sendDirectResponse(cancelCtx, cancelPrompt, "direct_cancel_prompt")
            await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
            return
          }

          if (directActionResult.action === "ask_explicit") {

            const turnoDetailsExplicit = appointmentCtx.turno
              ? `📅 ${appointmentCtx.turno.fecha} a las ${appointmentCtx.turno.hora}\n👨‍⚕️ ${appointmentCtx.turno.profesional}\n📍 ${appointmentCtx.turno.sede}`
              : "Tu turno programado"

            const askExplicitMessage = buildAskExplicitConfirmationMessage(turnoDetailsExplicit)

            const askExplicitCtx: DirectResponseContext = {
              phoneNumberId: value.metadata.phone_number_id,
              accessToken: config.accessToken,
              userPhoneNumber,
              configId: config.id,
              clienteId: config.cliente_id,
            }

            await sendDirectResponse(askExplicitCtx, askExplicitMessage, "ask_explicit_confirmation")
            await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
            return
          }
        }
      }
    }

    // ============================================================================
    // SPRINT 16: INTERCEPTAR CONSULTAS INFORMATIVAS (DIRECCION, HORARIO, ETC.)
    // Detecta "¿Cuál es la dirección?", "¿A qué hora es?", "¿Con quién es?", etc.
    // cuando hay un turno en contexto (appointmentData)
    // Responde directamente con la información solicitada sin reiniciar el flujo
    // IMPORTANTE: Ejecutar DESPUES de confirmación/cancelación pero ANTES de despedidas
    // ============================================================================
    if (message.type === "text") {
      const infoQueryFlags = await getEffectiveFeatureFlags(config.id)
      
      if (infoQueryFlags.directInformationalQuery) {
        
        // Obtener el appointmentContext si existe
        const appointmentData = await getAppointmentContext(userPhoneNumber, config.id)
        
        const infoQueryResult = await detectInformationalQueryPreFlow(
          userMessage,
          userPhoneNumber,
          config.id,
          appointmentData,
          true // useNLU para casos ambiguos
        )
        
        if (infoQueryResult.detected && infoQueryResult.response) {
          
          const infoCtx: DirectResponseContext = {
            phoneNumberId: value.metadata.phone_number_id,
            accessToken: config.accessToken,
            userPhoneNumber,
            configId: config.id,
            clienteId: config.cliente_id,
          }
          
          await sendDirectResponse(infoCtx, infoQueryResult.response, "informational_query")
          await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
          return
        }
      }
    }

    // ============================================================================
    // SPRINT 17: INTERCEPTAR MENSAJES CONTEXTUALES POST-ACCIÓN
    // Detecta mensajes como "Está con neumonía" después de una cancelación
    // y responde empáticamente sin reiniciar el flujo de bienvenida
    // ============================================================================
    if (message.type === "text") {
      const postActionFlags = await getEffectiveFeatureFlags(config.id)
      
      if (postActionFlags.postActionContextHandler) {
        
        const postActionResult = await detectPostActionContextPreFlow(
          userMessage,
          userPhoneNumber,
          config.id,
          true // useNLU para casos ambiguos
        )
        
        if (postActionResult.detected) {
          
          // Si hay respuesta directa, enviarla
          if (postActionResult.response) {
            const postActionCtx: DirectResponseContext = {
              phoneNumberId: value.metadata.phone_number_id,
              accessToken: config.accessToken,
              userPhoneNumber,
              configId: config.id,
              clienteId: config.cliente_id,
            }
            
            await sendDirectResponse(postActionCtx, postActionResult.response, "post_action_response")
            await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
            return
          }
          
          // Si debe pasar a OpenAI con contexto, continuar pero con contexto inyectado
          // TODO: Implementar paso a OpenAI con contexto post-acción
          // Por ahora, si no hay respuesta directa, continuar con flujo normal
        }
      }
    }
    
    // ============================================================================
    // SPRINT 12: INTERCEPTAR DESPEDIDAS PRE-FLUJO
    // Detecta "gracias", "chau", etc. ANTES de iniciar detección de paciente
    // NOTA: Se ejecuta DESPUES de confirmación/cancelación para evitar falsos positivos
    // ============================================================================
    if (message.type === "text") {
      const farewellFlags = await getEffectiveFeatureFlags(config.id)
      
      if (farewellFlags.directFarewellDetection) {
        
        const farewellResult = await detectFarewellPreFlow(
          userMessage,
          userPhoneNumber,
          config.id,
          true // useNLU para casos ambiguos
        )
        
        if (farewellResult.isFarewell && farewellResult.response) {
          
          const farewellCtx: DirectResponseContext = {
            phoneNumberId: value.metadata.phone_number_id,
            accessToken: config.accessToken,
            userPhoneNumber,
            configId: config.id,
            clienteId: config.cliente_id,
          }
          
          await sendDirectResponse(farewellCtx, farewellResult.response, "farewell_sent")
          await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
          return
        }
      }
    }

    // ============================================================================
    // SPRINT 13: INTERCEPTAR NUMERO EQUIVOCADO PRE-FLUJO
    // Detecta "se equivocaron de numero", "no soy esa persona", etc.
    // ANTES de iniciar deteccion de paciente
    // ============================================================================
    if (message.type === "text") {
      const wrongNumberFlags = await getEffectiveFeatureFlags(config.id)
      
      if (wrongNumberFlags.directWrongNumberDetection) {
        
        // Verificar si hubo recordatorio reciente (ventana de 24h)
        let hasRecentReminder = false
        if (config.cliente_id) {
          const templateSentAt = await getTemplateSentTime(config.cliente_id, userPhoneNumber)
          hasRecentReminder = templateSentAt !== null
        }
        
        const wrongNumberResult = await detectWrongNumberPreFlow(
          userMessage,
          userPhoneNumber,
          config.id,
          hasRecentReminder
        )
        
        if (wrongNumberResult.isWrongNumber && wrongNumberResult.response) {
          
          const wrongNumberCtx: DirectResponseContext = {
            phoneNumberId: value.metadata.phone_number_id,
            accessToken: config.accessToken,
            userPhoneNumber,
            configId: config.id,
            clienteId: config.cliente_id,
          }
          
  await sendDirectResponse(wrongNumberCtx, wrongNumberResult.response, "wrong_person_confirmed")
  await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
  return
  }
  }
  }
  
  // ============================================================================
  // SPRINT 18: NLU FALLBACK ROUTER
  // Cuando ningún handler específico detecta intención con alta confianza,
  // este handler NLU actúa como "fallback inteligente" para clasificar la intención real
  // Resuelve false positives y redirige al flujo correcto
  // ============================================================================
  if (message.type === "text") {
    const nluFallbackFlags = await getEffectiveFeatureFlags(config.id)
    
    if (nluFallbackFlags.nluFallbackRouter) {

      // Si el paciente está en un flujo de asistente especializado (ej: reagendamiento),
      // saltear el NLU fallback para no interceptar sus respuestas al asistente OpenAI.
      const nluRedis = getRedisClient()
      const specializedAssistantFlow = nluRedis
        ? await nluRedis.get(`specialized_assistant_active:${config.id}:${userPhoneNumber}`)
        : null

      if (specializedAssistantFlow) {
        logger.info("[NLU-FALLBACK] Saltando NLU fallback — paciente en flujo de asistente especializado", {
          specializedFlow: specializedAssistantFlow,
        })
      } else {

      // Obtener el appointmentContext si existe
      const appointmentData = await getAppointmentContext(userPhoneNumber, config.id)

      // ¿El turno activo ya fue confirmado? Si es así, no debemos volver a ofrecer
      // "Confirmar asistencia" cuando el paciente escribe texto libre (ej: "¿puedo obtener otro turno?")
      const appointmentAlreadyConfirmed = await isAppointmentConfirmed(
        userPhoneNumber,
        config.id,
        getAppointmentRef(appointmentData)
      )

      const nluFallbackResult = await detectNLUFallbackPreFlow(
        userPhoneNumber,
        userMessage,
        config.id,
        appointmentData,
        undefined, // conversationHistory - puede agregarse después si es necesario
        config.escalationPhoneNumber, // Número de derivación para consultas que no podemos responder
        appointmentAlreadyConfirmed
      )
      
      if (nluFallbackResult.shouldHandle && nluFallbackResult.response) {
        
        const nluCtx: DirectResponseContext = {
          phoneNumberId: value.metadata.phone_number_id,
          accessToken: config.accessToken,
          userPhoneNumber,
          configId: config.id,
          clienteId: config.cliente_id,
        }
        
        await sendDirectResponse(nluCtx, nluFallbackResult.response, "nlu_fallback_response")
        
        // Si fue confirmación, actualizar stats y marcar el turno como confirmado
        if (nluFallbackResult.result?.intent === "confirmar_asistencia" && appointmentData) {
          await trackAppointmentEvent(config.cliente_id, userPhoneNumber, "direct_confirm", appointmentData.appointment_id)
          await markAppointmentConfirmed(userPhoneNumber, config.id, getAppointmentRef(appointmentData))
        }
        
        // Si fue cancelación, establecer flowState para doble confirmación
        if (nluFallbackResult.result?.intent === "cancelar_turno") {
          if (appointmentData) {
            // Buscar el turnoIndex (0 por defecto si hay turnos)
            const turnoIdx = (appointmentData.turnos && appointmentData.turnos.length > 0) ? 0 : undefined
            await setFlowState(userPhoneNumber, config.id, {
              type: "awaiting_cancel_confirmation",
              createdAt: new Date().toISOString(),
              turnoIndex: turnoIdx,
            })
          }
        }

        // Si el handler devolvió una directiva de flujo, establecer estado.
        // Aplica a cualquier intent (reagendar_turno, explicacion_contextual, no_asisti, etc.)
        if (nluFallbackResult.flowStateDirective && appointmentData) {
          const turnoIdx = (appointmentData.turnos && appointmentData.turnos.length > 0) ? 0 : undefined
          const directive = nluFallbackResult.flowStateDirective
          await setFlowState(userPhoneNumber, config.id, {
            type: directive.type,
            createdAt: new Date().toISOString(),
            turnoIndex: turnoIdx,
            ...(directive.type === "awaiting_cancel_confirmation" && directive.postCancelAction
              ? { postCancelAction: directive.postCancelAction }
              : {}),
          })
        }
        
        await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
        return
      }

      } // end else (no specialized assistant flow)
    }
  }

  // ============================================================================
  // NEW: INTERCEPTAR DETECCION INICIAL DE PACIENTE (Sin recordatorio previo)
    // Sprint 9a-c: Nuevo flujo deterministico de deteccion e intake
    // ============================================================================
    if (message.type === "text" || message.type === "interactive") {
      const detectionFlags = await getEffectiveFeatureFlags(config.id)
      
      // Verificar si debe usar detección de paciente
      const hasPendingReminder = false // TODO: Verificar si hay recordatorio pendiente en el contexto
      const shouldDetect = await shouldUsePatientDetection(userPhoneNumber, config.id, hasPendingReminder)
      
      if (detectionFlags.directPatientDetection && shouldDetect) {
        
        // Primero verificar si ya hay un flujo de detección activo (Sprint 9a, 9b o 9c)
        const detectionActive = await isPatientDetectionFlowActive(userPhoneNumber) ||
                               await isExistingPatientFlowActive(userPhoneNumber) || 
                               await isNewPatientFlowActive(userPhoneNumber)

        // Si hay appointmentContext activo (usuario llegó por template), el paciente ya está
        // identificado — no reiniciar detección aunque la API devuelva pacientes_multiples.
        const existingAppointmentCtx = await getAppointmentContext(userPhoneNumber, config.id)

        // Si el paciente ya fue identificado en esta sesión (p.ej. flujo terminó con "obra social
        // no habilitada" y el usuario responde "Ok"), no reiniciar la detección.
        const alreadyIdentified = await getIdentifiedPatient(userPhoneNumber)

        console.log("[v0] [SPRINT9A] detectionActive:", detectionActive, "existingCtx:", !!existingAppointmentCtx, "alreadyIdentified:", !!alreadyIdentified)
        
        if (!detectionActive && !existingAppointmentCtx && !alreadyIdentified) {
          // No hay flujo activo ni contexto de template, iniciar detección
          // Se pasa config.id (configId para flags/logging) y config.cliente_id (clienteId para API)
          const detectionTemplateSentAt = await getTemplateSentTime(config.cliente_id, userPhoneNumber)
          const detectionHasReminder = detectionTemplateSentAt !== null
          const detectionResult = await initializePatientDetection(userPhoneNumber, config.id, config.cliente_id, config.displayName, userMessage, detectionHasReminder)

          console.log("[v0] [SPRINT9A] initializePatientDetection result:", JSON.stringify({ handled: detectionResult.handled, action: detectionResult.action, shouldCallOpenAI: detectionResult.shouldCallOpenAI }))
          
          if (detectionResult.handled) {
            const detectionCtx: DirectResponseContext = {
              phoneNumberId: value.metadata.phone_number_id,
              accessToken: config.accessToken,
              userPhoneNumber,
              configId: config.id,
              clienteId: config.cliente_id,
            }

            const greetingText = detectionResult.message || ""
            if (detectionResult.buttons && detectionResult.buttons.length > 0) {
              // Enviar como mensaje interactivo con Reply Buttons
              try {
                await sendWhatsAppInteractive(
                  value.metadata.phone_number_id,
                  config.accessToken,
                  userPhoneNumber,
                  greetingText,
                  detectionResult.buttons,
                )
              } catch (btnErr) {
                // Fallback a mensaje de texto si interactive falla
                console.warn("[v0] [SPRINT9A] Interactive send failed, fallback to text:", btnErr)
                await sendDirectResponse(detectionCtx, greetingText, "initial_detection_pending")
              }
            } else {
              await sendDirectResponse(detectionCtx, greetingText, "initial_detection_pending")
            }
            await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
            return
          }
        } else if (!detectionActive && !existingAppointmentCtx && alreadyIdentified) {
          // El paciente ya fue identificado en esta sesión (cache identified_patient, TTL 1h)
          // pero no hay flujo de detección activo. En vez de delegar a OpenAI (que re-pide DNI
          // e improvisa un menú), re-ejecutamos la detección determinística.
          // initializePatientDetection vuelve a consultar por teléfono, construye el saludo
          // estructurado correcto (incluido el de "sin turnos", Sprint 43) y deja el estado de
          // detección activo para que la siguiente selección (1/2/3) sea interceptada por el
          // bloque isDetectionActive, nunca por OpenAI.
          console.log("[v0] [SPRINT9A] Rehidratando detección de paciente identificado (alreadyIdentified)")

          const rehydrationTemplateSentAt = await getTemplateSentTime(config.cliente_id, userPhoneNumber)
          const rehydrationHasReminder = rehydrationTemplateSentAt !== null
          const detectionResult = await initializePatientDetection(userPhoneNumber, config.id, config.cliente_id, config.displayName, undefined, rehydrationHasReminder)

          if (detectionResult.handled && detectionResult.message) {
            const detectionCtx: DirectResponseContext = {
              phoneNumberId: value.metadata.phone_number_id,
              accessToken: config.accessToken,
              userPhoneNumber,
              configId: config.id,
              clienteId: config.cliente_id,
            }

            if (detectionResult.buttons && detectionResult.buttons.length > 0) {
              try {
                await sendWhatsAppInteractive(
                  value.metadata.phone_number_id,
                  config.accessToken,
                  userPhoneNumber,
                  detectionResult.message,
                  detectionResult.buttons,
                )
              } catch (btnErr) {
                console.warn("[v0] [SPRINT9A] Interactive send failed (rehydration), fallback to text:", btnErr)
                await sendDirectResponse(detectionCtx, detectionResult.message, "rehydrated_patient_detection")
              }
            } else {
              await sendDirectResponse(detectionCtx, detectionResult.message, "rehydrated_patient_detection")
            }
            await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
            return
          }
        }
      }
    }

    // ============================================================================
    // INTERCEPTAR FLUJOS ACTIVOS: Detección inicial, Paciente Existente o Nuevo (Sprint 9a-c)
    // ============================================================================
    if (message.type === "text" || message.type === "interactive") {
      // Si hay un booking flow activo (Sprint 6-8), tiene prioridad sobre el flujo de paciente nuevo.
      // El booking flow se procesa más adelante (línea ~2083) con handleBookingSelectionIfPending.
      // Evitamos que new_patient_flow intercepte mensajes que le pertenecen al booking flow.
      const activeBookingState = await getBookingFlowState(userPhoneNumber, config.id)
      const bookingFlowHasActiveStep = !!activeBookingState?.step

      // Verificar si hay algún flujo activo de Sprint 9a, 9b o 9c
      // Si el booking flow tiene un paso activo, excluir new_patient_flow de la intercepción
      const isDetectionActive = await isPatientDetectionFlowActive(userPhoneNumber) ||
                               await isExistingPatientFlowActive(userPhoneNumber) ||
                               (!bookingFlowHasActiveStep && await isNewPatientFlowActive(userPhoneNumber))
      
      if (isDetectionActive) {
        const detectionFlags = await getEffectiveFeatureFlags(config.id)
        
        // Procesar mensaje durante detección
        let detectionResult = null
        
        if (await isPatientDetectionFlowActive(userPhoneNumber)) {
          // Sprint 9a: Flujo de detección inicial (menú principal, desambiguación por DNI, etc.)
          detectionResult = await handlePatientDetectionMessage(userPhoneNumber, userMessage, config.cliente_id)
        } else if (await isExistingPatientFlowActive(userPhoneNumber)) {
          detectionResult = await handleExistingPatientMessage(
            userPhoneNumber,
            userMessage,
            config.cliente_id,
            config.escalationPhoneNumber,
            {
              enableSearchByProfessional: config.enableSearchByProfessional !== false,
              enableSearchBySpecialty: config.enableSearchBySpecialty !== false,
              enableSearchByAnyDoctor: config.enableSearchByAnyDoctor !== false,
            }
          )
        } else if (await isNewPatientFlowActive(userPhoneNumber)) {
          detectionResult = await handleNewPatientMessage(
            userPhoneNumber,
            userMessage,
            config.cliente_id,
            config.escalationPhoneNumber,
            {
              enableSearchByProfessional: config.enableSearchByProfessional !== false,
              enableSearchBySpecialty: config.enableSearchBySpecialty !== false,
              enableSearchByAnyDoctor: config.enableSearchByAnyDoctor !== false,
            }
          )
        }
        
        const detectionCtx: DirectResponseContext = {
          phoneNumberId: value.metadata.phone_number_id,
          accessToken: config.accessToken,
          userPhoneNumber,
          configId: config.id,
          clienteId: config.cliente_id,
        }

        // Acciones especiales del flujo de detección inicial (Sprint 9a) que necesitan clienteId
        if (detectionResult?.action === 'dni_disambiguation_pending') {
          // Paciente ingresó DNI para desambiguar múltiples pacientes
          const dniResult = await handleDNIForMultiplePatients(
            userPhoneNumber, userMessage, config.id, config.cliente_id, config.displayName
          )
          if (dniResult.handled && dniResult.message) {
            await sendDirectResponse(detectionCtx, dniResult.message, "dni_disambiguation")
            await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
            return
          }
        }

        if (detectionResult?.action === 'contact_intent_pending') {
          // Paciente nuevo seleccionó su intención: turno (1) o consulta (2)
          // Detectar selección por número O por texto natural
          const { detectMenuOption, NEW_PATIENT_MENU } = await import('./conversation-state/patient-detection/menu-option-detector')

          let selection: number | null = null

          // Capa 1: número directo
          const numMatch = userMessage.trim().match(/^[1-2]$/)
          if (numMatch) {
            selection = parseInt(numMatch[0], 10)
          } else {
            // Capa 2: detección por texto natural (keywords)
            const menuResult = await detectMenuOption(userMessage, NEW_PATIENT_MENU, userPhoneNumber)
            if (menuResult.detected && menuResult.selectedOption) {
              selection = menuResult.selectedOption
            }
          }

          if (!selection) {
            await sendDirectResponse(
              detectionCtx,
              'Por favor, respondé con 1 o 2 según tu intención.',
              "contact_intent_invalid"
            )
            await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
            return
          }


          if (selection === 1) {
            // Opción 1: Solicitar turno ��� cambiar fase a awaiting_initial_response (pedir DNI)
            await updatePatientDetectionPhase(userPhoneNumber, 'awaiting_initial_response')
            const turnoConfirmMessage = await import('./conversation-state/patient-detection/patient-templates').then(
              m => m.buildTurnoIntentConfirmedMessage()
            )
            await sendDirectResponse(detectionCtx, turnoConfirmMessage, "contact_intent_turno")
            await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
            return
          } else if (selection === 2) {
            // Opción 2: Consulta — derivar teléfono y terminar flujo
            const otherInquiryMessage = await import('./conversation-state/patient-detection/patient-templates').then(
              m => m.buildOtherInquiryMessage(config.escalationPhoneNumber, config.displayName)
            )
            await sendDirectResponse(detectionCtx, otherInquiryMessage, "contact_intent_consulta")
            await completePatientDetectionFlow(userPhoneNumber, config.id)
            await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
            return
          }
        }

        // Paciente existente eligió "Solicitar turno para un familiar" (opción 2 del menú sin-turnos)
        if (detectionResult?.action === 'familiar_appointment_intent') {
          await updatePatientDetectionPhase(userPhoneNumber, 'awaiting_familiar_dni')
          const familiarDNIMessage = await import('./conversation-state/patient-detection/patient-templates').then(
            m => m.buildFamiliarDNIRequestMessage()
          )
          await sendDirectResponse(detectionCtx, familiarDNIMessage, "familiar_appointment_intent")
          await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
          return
        }

        // Paciente envió "0" (volver) desde el submenú de DNI del familiar
        if (detectionResult?.action === 'familiar_back_to_main') {
          const backMenuResult = await initializePatientDetection(
            userPhoneNumber,
            config.id,
            config.cliente_id,
            config.displayName
          )
          if (backMenuResult?.handled && backMenuResult.message) {
            await sendDirectResponse(detectionCtx, backMenuResult.message, "familiar_back_to_main_menu")
          } else {
            await sendDirectResponse(detectionCtx, 'Volvamos al inicio. ¿En qué puedo ayudarte?', "familiar_back_fallback")
          }
          await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
          return
        }

        // Paciente ingresó el DNI del familiar
        if (detectionResult?.action === 'familiar_dni_pending') {
          // "Volver al menú principal" desde el submenú de DNI del familiar (fallback vía isBackCommand)
          const { isBackCommand } = await import('./conversation-state/shared/back-navigation')
          if (isBackCommand(userMessage)) {
            const mainMenuResult = await initializePatientDetection(
              userPhoneNumber,
              config.id,
              config.cliente_id,
              config.displayName
            )
            if (mainMenuResult?.handled && mainMenuResult.message) {
              await sendDirectResponse(detectionCtx, mainMenuResult.message, "familiar_back_to_main_menu")
            } else {
              await sendDirectResponse(detectionCtx, 'Volvamos al inicio. ¿En qué puedo ayudarte?', "familiar_back_fallback")
            }
            await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
            return
          }

          const dniOnly = userMessage.trim().replace(/[^0-9]/g, '')
          const { ClinicAPI } = await import('./clinic-api')
          const clinicAPI = new ClinicAPI(config.cliente_id)
          const patientResponse = await clinicAPI.paciente_dni(dniOnly)

          if (!patientResponse.exito || !patientResponse.datos) {
            // Familiar NO encontrado → iniciar flujo de paciente nuevo con ese DNI (modo familiar)
            const newPatientResult = await initializeNewPatientFlow(dniOnly, userPhoneNumber, config.cliente_id, true, userMessage)
            if (newPatientResult?.handled && newPatientResult.message) {
              await sendDirectResponse(detectionCtx, newPatientResult.message, "familiar_new_patient")
              await completePatientDetectionFlow(userPhoneNumber, config.id)
              await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
              return
            }
          } else {
            // Familiar encontrado → iniciar flujo de paciente existente
            const patientData = patientResponse.datos
            let familiar: any = null
            if (patientData.paciente) {
              familiar = patientData.paciente
            } else if (Array.isArray(patientData) && patientData.length > 0) {
              familiar = patientData[0]
            } else {
              familiar = patientData
            }

            const familiarId = familiar.paciente_id || familiar.Id || familiar.id || ''
            const familiarName = familiar.nombre || `${(familiar.Nombres || familiar.nombres || '').trim()} ${(familiar.Apellido || familiar.apellido || '').trim()}`.trim()
            const familiarDNI = (familiar.Nrodoc || familiar.dni || dniOnly).toString()
            const familiarEmail = (() => {
              const raw = (familiar.Mail || familiar.mail || familiar.Email || familiar.email || '').trim()
              return raw === '-' || raw === 'NO USA' ? '' : raw
            })()
            const familiarCelular = (familiar.Celular || familiar.celular || familiar.Telefono || familiar.telefono || '').trim()
            const familiarObraSocialId = (familiar.Deudor_Id || familiar.deudor_id || '').toString().trim()
            const familiarObraSocialNombre = (familiar.Deudor_Nombre || familiar.deudor_nombre || '').toString().trim()

            const existingResult = await initializeExistingPatientFlow(
              userPhoneNumber,
              familiarId,
              familiarName,
              familiarDNI,
              familiarEmail || undefined,
              config.cliente_id,
              {
                patientFirstName: (familiar.Nombres || familiar.nombres || '').trim(),
                patientLastName: (familiar.Apellido || familiar.apellido || '').trim(),
                patientCelular: familiarCelular,
                obraSocialId: familiarObraSocialId,
                obraSocialNombre: familiarObraSocialNombre,
              },
              config.escalationPhoneNumber,
              userMessage
            )
            if (existingResult?.handled && existingResult.message) {
              await sendExistingPatientResult(detectionCtx, existingResult, "familiar_existing_patient")
              await completePatientDetectionFlow(userPhoneNumber, config.id)
              await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
              return
            }
          }
        }

        if (detectionResult?.action === 'new_patient_dni_pending') {
          // Paciente nuevo ingresó DNI — derivar al flujo de paciente nuevo
          const dniOnly = userMessage.trim().replace(/[^0-9]/g, '')
          const newPatientResult = await initializeNewPatientFlow(dniOnly, userPhoneNumber, config.cliente_id, false, userMessage)
          if (newPatientResult?.handled && newPatientResult.message) {
            await sendDirectResponse(detectionCtx, newPatientResult.message, "new_patient_flow")
            await completePatientDetectionFlow(userPhoneNumber, config.id)
            await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
            return
          }
        }

        // "Volver al menú principal": el usuario eligió volver desde el primer paso de un
        // flujo de reserva. El flujo ya limpió su propio estado; re-iniciamos la detección
        // para volver a mostrar el menú principal (saludo con turnos / opciones).
        if (detectionResult?.action === 'go_back_to_menu') {
          // El paciente eligió "0- Volver al menú anterior" desde el menú post-confirmación.
          // El handler ya limpió postActionContext y generó el menú completo.
          if (detectionResult.message) {
            await sendDirectResponse(detectionCtx, detectionResult.message, "go_back_to_menu")
          }
          await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
          return
        }

        if (detectionResult?.action === 'back_to_main_menu') {
          const mainMenuResult = await initializePatientDetection(
            userPhoneNumber,
            config.id,
            config.cliente_id,
            config.displayName
          )
          if (mainMenuResult?.handled && mainMenuResult.message) {
            await sendDirectResponse(detectionCtx, mainMenuResult.message, "back_to_main_menu")
          } else {
            await sendDirectResponse(
              detectionCtx,
              'Volvamos al inicio. ¿En qué puedo ayudarte?',
              "back_to_main_menu_fallback"
            )
          }
          await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
          return
        }

        if (detectionResult?.handled) {
          if (detectionResult.message) {
            const _dr = detectionResult as any
            await sendExistingPatientResult(detectionCtx, {
              message: detectionResult.message,
              sedesListRows: _dr.sedesListRows,
              searchTypeButtons: _dr.searchTypeButtons,
              verMasButton: _dr.verMasButton,
            }, "detection_flow")
          }

          // Cuando el paciente seleccionó una opción del menú inicial, derivar al flujo correcto
          // Type guard: solo PatientDetectionResult tiene action
          if ('action' in detectionResult && detectionResult.action && 'patientInfo' in detectionResult && detectionResult.patientInfo) {
            const patientInfo = detectionResult.patientInfo

            if (detectionResult.action === 'other_inquiry_intent') {
              // Paciente existente sin turnos eligió "Realizar otra consulta" → derivar a tel����fono
              const escalationPhone = config.escalationPhoneNumber || 'nuestro equipo'
              const otherInquiryMessage = await import('./conversation-state/patient-detection/patient-templates').then(
                m => m.buildOtherInquiryMessage(config.escalationPhoneNumber, config.displayName)
              )
              await sendDirectResponse(detectionCtx, otherInquiryMessage, "other_inquiry_existing_patient")
              await completePatientDetectionFlow(userPhoneNumber, config.id)
              await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
              return
            }

            if (detectionResult.action === 'book_new_appointment' || detectionResult.action === 'other_inquiry') {
              // Verificar si ya hay un flujo de paciente existente activo y más avanzado
              const existingPhase = await getExistingPatientFlowPhase(userPhoneNumber)
              
              // Fases m��s avanzadas que awaiting_sede (ya pasaron la selección de sede)
              const advancedPhases = [
                'awaiting_search_type', 'awaiting_professional_name', 'awaiting_especialidad',
                'awaiting_turno_selection', 'awaiting_email', 'awaiting_confirmation'
              ]
              
              if (existingPhase && advancedPhases.includes(existingPhase)) {
                // Ya hay un flujo activo más avanzado - procesar el mensaje "1" en ese contexto
                const existingResult = await handleExistingPatientMessage(
                  userPhoneNumber,
                  userMessage,
                  config.cliente_id,
                  config.escalationPhoneNumber,
                  {
                    enableSearchByProfessional: config.enableSearchByProfessional !== false,
                    enableSearchBySpecialty: config.enableSearchBySpecialty !== false,
                    enableSearchByAnyDoctor: config.enableSearchByAnyDoctor !== false,
                  }
                )
                if (existingResult?.handled && existingResult.message) {
                  await sendExistingPatientResult(detectionCtx, existingResult, "existing_patient_flow")
                }
                await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
                return
              }

              // Derivar a flujo de paciente existente para reservar turno
              const existingResult = await initializeExistingPatientFlow(
                userPhoneNumber,
                patientInfo.patientId || '',
                patientInfo.patientName || '',
                '', // DNI vendrá del estado de detección
                undefined, // Email será ingresado por el usuario
                config.cliente_id,
                // No pasar additionalPatientData - serán recuperados del estado de detección en initializeExistingPatientFlow
                undefined,
                config.escalationPhoneNumber,
                userMessage // Para entity extraction del mensaje que disparó el flujo
              )
              if (existingResult?.handled && existingResult.message) {
                await sendExistingPatientResult(detectionCtx, existingResult, "existing_patient_flow")
              }

              // Limpiar estado de detección DESPUÉS de inicializar el flujo
              await completePatientDetectionFlow(userPhoneNumber, config.id)
            } else if (detectionResult.action === 'confirm_appointment' || detectionResult.action === 'cancel_appointment' || detectionResult.action === 'cancel_and_book_new_appointment') {
              // Sprint 9a: Manejar confirmación/cancelación directamente con los turnos del paciente detectado
              // 'cancel_and_book_new_appointment' = el paciente quiere solicitar otro turno teniendo uno activo:
              // primero debe cancelar (doble confirmación) y luego inicia el flujo de reserva nueva.
              
              // Verificar que tenemos turnos del paciente
              if (patientInfo?.turnos && patientInfo.turnos.length > 0) {
                const turno = patientInfo.turnos[0] // Primer turno (referencia para sede_id global)

                // Convertir los turnos del flujo de detección al formato ChatbotData.
                // El DNI y apellido provienen del estado de detección (necesarios para el
                // payload del proxy de cancelación: "al menos teléfono o DNI del paciente").
                const chatbotData: ChatbotData = {
                  paciente: {
                    nombres: patientInfo.patientFirstName || patientInfo.patientName || 'Paciente',
                    apellido: patientInfo.patientLastName || '',
                    dni: patientInfo.patientDNI || '',
                    telefono: userPhoneNumber,
                    // Obra social del paciente identificado (Deudor_Id/Nombre del proxy),
                    // necesaria para el resumen de confirmación y para enviar Deudor_Id
                    // al sistema externo al reservar el turno reagendado.
                    obra_social_id: patientInfo.obraSocialId,
                    obra_social_nombre: patientInfo.obraSocialNombre,
                  },
                  turnos: patientInfo.turnos.map((t: any): ChatbotDataTurno => ({
                    fecha: t.Fecha || t.fecha,
                    fecha_formateada: t.Fecha || t.fecha,
                    hora: t.Hora || t.hora,
                    hora_formateada: (t.Hora || t.hora || '').substring(0, 5),
                    profesional: t.Profesional_Nombre || t.profesional || '',
                    profesional_id: t.Profesional_Id || t.profesional_id || '',
                    sede: t.Centro_Nombre || t.sede || '',
                    sede_id: t.Sede_Id || t.sede_id || '',
                    direccion: t.Direccion || t.direccion || '',
                    agenda_id: t.Agenda_Id || t.agenda_id || '',
                    admite_reagendamiento: t.admite_reagendamiento || false,
                    tipo: t.Motivo_Nombre || t.tipo || 'consulta',
                    estado: t.Estado || t.estado || '',
                  })),
                  cantidad_turnos: patientInfo.turnos.length,
                  sede_id: turno.Sede_Id || turno.sede_id || '',
                  clinica: config.displayName || 'Clínica',
                  tipo_mensaje: 'user_initiated',
                }

                // Guardar el contexto para que el flujo de confirmación/cancelación lo use
                await saveAppointmentContext(userPhoneNumber, config.id, chatbotData)

                // Si el paciente tiene MÁS DE UN turno, primero debe elegir sobre cuál operar,
                // SALVO que todos sean en la misma fecha: el backend los confirma/cancela juntos.
                const allSameDateDetect = patientInfo.turnos.every(
                  (t: any) => (t.Fecha || t.fecha) === (patientInfo.turnos[0].Fecha || patientInfo.turnos[0].fecha)
                )
                if (patientInfo.turnos.length > 1 && !allSameDateDetect) {
                  await setFlowState(userPhoneNumber, config.id, {
                    type: 'awaiting_turno_selection',
                    createdAt: new Date().toISOString(),
                    pendingAction: detectionResult.action as
                      | 'confirm_appointment'
                      | 'cancel_appointment'
                      | 'cancel_and_book_new_appointment',
                  })
                  const selectionMsg = buildTurnoSelectionMessage(
                    chatbotData,
                    detectionResult.action as
                      | 'confirm_appointment'
                      | 'cancel_appointment'
                      | 'cancel_and_book_new_appointment'
                  )
                  await sendDirectResponse(detectionCtx, selectionMsg, "turno_selection")
                } else if (detectionResult.action === 'confirm_appointment') {
                  // Un solo turno: confirmar asistencia. Primero impactar en el sistema externo (proxy).
                  const proxySuccess = await confirmarTurnoEnProxy(config, chatbotData, 0, userPhoneNumber)

                  if (proxySuccess) {
                    const confirmMsg = buildConfirmationMessage(chatbotData, 0)
                    await sendDirectResponse(detectionCtx, confirmMsg, "confirm_flow")

                    // Marcar TODOS los turnos como confirmados (el backend los confirma juntos)
                    const updatedTurnosDetect = (chatbotData.turnos || []).map((t: any) => ({
                      ...t, Estado: 'Confirmado', estado: 'Confirmado'
                    }))
                    const menuAfterDetect = await returnPatientToMenu(userPhoneNumber, updatedTurnosDetect, 'just_confirmed')
                    if (menuAfterDetect) await sendDirectResponse(detectionCtx, menuAfterDetect, "return_to_menu")
                  } else {
                    await sendDirectResponse(
                      detectionCtx,
                      "Hubo un problema al confirmar tu turno. Por favor intentá de nuevo en unos momentos.",
                      "confirm_flow_error"
                    )
                  }
                } else {
                  // Un solo turno, cancelación (o cancelar+solicitar nuevo): mostrar doble confirmación
                  const wantsBookNew = detectionResult.action === 'cancel_and_book_new_appointment'

                  // Setear estado de flujo para esperar confirmación.
                  // Si el paciente eligió "cancelar y solicitar uno nuevo", marcamos postCancelAction
                  // para que tras la cancelaci��n exitosa se inicie el flujo de reserva nueva.
                  await setFlowState(userPhoneNumber, config.id, {
                    type: 'awaiting_cancel_confirmation',
                    createdAt: new Date().toISOString(),
                    turnoIndex: 0,
                    ...(wantsBookNew ? { postCancelAction: 'book_new' as const } : {}),
                  })

                  // Construir y enviar mensaje de doble confirmación
                  const doubleConfirmMsg = buildCancelDoubleConfirmMessage(chatbotData, 0)
                  await sendDirectResponse(detectionCtx, doubleConfirmMsg, "cancel_flow")
                }
              } else {
                // Sin turnos - no debería pasar, pero por seguridad derivar a OpenAI
              }
            }
          }

          // Si el flujo completó (Sprint 9b/9c), limpiar
          if (detectionResult.flowCompleted) {
            await clearExistingPatientFlow(userPhoneNumber)
            await clearNewPatientFlow(userPhoneNumber, config.id)
          }

          await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
          return
        }
      }
    }

    // ============================================================================
    // INTERCEPTAR FLUJO DE RESERVA (Sprint 6-8: Paciente Nuevo/Existente)
    // Si hay un booking flow activo con selección numérica, resolver directamente
    // ============================================================================
    if (message.type === "text" || message.type === "interactive") {
      const bookingFlags = await getEffectiveFeatureFlags(config.id)
      if (bookingFlags.directBookingFlow) {
        const bookingResult = await handleBookingSelectionIfPending(userMessage, userPhoneNumber, config.id)
        if (bookingResult.handled) {
          const bookingLogger = createConversationLogger(userPhoneNumber, config.id, "booking-flow")
          const bookingCtx: DirectResponseContext = {
            phoneNumberId: value.metadata.phone_number_id,
            accessToken: config.accessToken,
            userPhoneNumber,
            configId: config.id,
            clienteId: config.cliente_id,
          }

          if (bookingResult.type === "invalid_selection") {
            bookingLogger.warn("Seleccion fuera de rango en booking flow", { userMessage })
            await sendDirectResponse(bookingCtx, bookingResult.errorMessage, "booking-flow")
            return
          }

          if (bookingResult.type === "valid_turno") {
            // Turno seleccionado: mostrar confirmación directamente
            bookingLogger.info("Turno seleccionado correctamente via backend (sin off-by-one)", {
              turnoId: bookingResult.turno.idTurno,
              hora: bookingResult.turno.hora,
            })
            await sendDirectResponse(bookingCtx, bookingResult.confirmationMessage, "booking-flow")
            return
          }

          if (bookingResult.type === "valid_selection") {
            // Selección de obra social / sede / profesional / especialidad
            bookingLogger.info("Seleccion valida en booking flow", {
              step: bookingResult.nextStep,
            })

            // Cuando se transiciona a awaiting_sede_selection, las sedes NO están
            // guardadas en el estado del booking flow. Las buscamos ahora, las
            // persistimos en el estado y las incluimos en el mensaje.
            if (bookingResult.nextStep === "awaiting_sede_selection") {
              try {
                const sedesResult = await fetchSedes(config.cliente_id)
                if (sedesResult.success && sedesResult.sedes && sedesResult.sedes.length > 0) {
                  const sedesMapped = sedesResult.sedes.map(s => ({
                    numero: s.numero,
                    id: s.id,
                    nombre: s.nombre,
                    domicilio: s.domicilio,
                    localidad: s.localidad,
                    provincia: s.provincia,
                  }))
                  const currentBookingState = await getBookingFlowState(userPhoneNumber, config.id)
                  if (currentBookingState) {
                    await setBookingFlowState(userPhoneNumber, config.id, {
                      ...currentBookingState,
                      sedeOptions: sedesMapped,
                    })
                  }
                  // Intentar enviar como lista interactiva (soporta hasta 10 sedes)
                  try {
                    const listRows = sedesResult.sedes.map(s => ({
                      id: String(s.numero),
                      title: s.nombre.substring(0, 24),
                      description: [s.domicilio, s.localidad].filter(Boolean).join(', ').substring(0, 72),
                    }))
                    // Cuerpo completo: confirmación de obra social + lista numerada + instrucción híbrida
                    const listBody = `${bookingResult.confirmationMessage}\n\n${buildSedesMessage(sedesResult.sedes)}`
                    await sendWhatsAppList(
                      value.metadata.phone_number_id,
                      config.accessToken,
                      userPhoneNumber,
                      listBody,
                      "Ver sedes",
                      listRows,
                      "Sedes disponibles",
                    )
                  } catch (listErr) {
                    // Fallback a texto plano con lista numerada
                    bookingLogger.warn("List message failed, fallback to text", listErr as Error)
                    const sedeListMsg = `${bookingResult.confirmationMessage}\n\n${buildSedesMessage(sedesResult.sedes)}`
                    await sendDirectResponse(bookingCtx, sedeListMsg, "booking-flow")
                  }
                  return
                }
              } catch (err) {
                bookingLogger.warn("Error prefetching sedes for booking flow", err as Error)
              }
            }

            // Cuando se transiciona a awaiting_search_type_selection, enviar con Reply Buttons
            if (bookingResult.nextStep === "awaiting_search_type_selection") {
              try {
                await sendWhatsAppInteractive(
                  value.metadata.phone_number_id,
                  config.accessToken,
                  userPhoneNumber,
                  bookingResult.confirmationMessage,
                  [
                    { id: "1", title: "Médico particular" },
                    { id: "2", title: "Por especialidad" },
                    { id: "3", title: "Cualquier médico" },
                  ],
                )
                return
              } catch (intErr) {
                bookingLogger.warn("Interactive failed for search type, fallback to text", intErr as Error)
              }
            }

            await sendDirectResponse(bookingCtx, bookingResult.confirmationMessage, "booking-flow")
            return
          }

          if (bookingResult.type === "search_type_selected") {
            // Tipo de búsqueda seleccionado - si requiere mensaje directo (médico particular), enviarlo
            // Para especialidad y cualquier médico, OpenAI continúa con el contexto inyectado
            if (bookingResult.nextMessage) {
              bookingLogger.info("Tipo busqueda seleccionado con mensaje directo", {
                searchType: bookingResult.searchType,
              })
              await sendDirectResponse(bookingCtx, bookingResult.nextMessage, "booking-flow")
              return
            }
            // Sin mensaje directo: dejar caer a OpenAI con contexto inyectado
            bookingLogger.info("Tipo busqueda seleccionado, continuando a OpenAI con contexto", {
              searchType: bookingResult.searchType,
            })
            // Continua al enqueue con contexto enriquecido
          }

          // ------------------------------------------------------------------
          // Nuevos tipos: manejo de texto libre en awaiting_turno_selection
          // ------------------------------------------------------------------

          if (bookingResult.type === "turno_filtered") {
            bookingLogger.info("Lista de turnos filtrada, re-mostrando")
            await sendDirectResponse(bookingCtx, bookingResult.message, "booking-flow-filter")
            await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
            return
          }

          if (bookingResult.type === "no_filter_results") {
            bookingLogger.info("Filtro sin resultados", { filterDesc: bookingResult.filterDesc })
            // Re-mostrar lista completa con mensaje informativo
            const currentBookingState = await getBookingFlowState(userPhoneNumber, config.id)
            const fullOptions = currentBookingState?.fullTurnoOptions ?? currentBookingState?.turnoOptions ?? []
            const { buildNoFilterResultsMessage } = await import("./conversation-state/booking-turno-filter")
            const noResultsMsg = buildNoFilterResultsMessage(
              bookingResult.filterDesc,
              fullOptions,
              config.displayName
            )
            await sendDirectResponse(bookingCtx, noResultsMsg, "booking-flow-filter")
            await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
            return
          }

          if (bookingResult.type === "turno_selection_clarify") {
            bookingLogger.info("NLU solicita aclaración para selección de turno")
            await sendDirectResponse(bookingCtx, bookingResult.clarificationMessage, "booking-flow-clarify")
            await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
            return
          }

          if (bookingResult.type === "turno_selection_question") {
            bookingLogger.info("Consulta intercalada en selección de turno respondida")
            await sendDirectResponse(bookingCtx, bookingResult.response, "booking-flow-question")
            await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
            return
          }

          if (bookingResult.type === "booking_exit_flow") {
            bookingLogger.info("Usuario salió del flujo de reserva")
            const currentBookingState2 = await getBookingFlowState(userPhoneNumber, config.id)
            if (currentBookingState2) {
              await setBookingFlowState(userPhoneNumber, config.id, {
                ...currentBookingState2,
                step: null,
              })
            }
            await sendDirectResponse(
              bookingCtx,
              "Entendido. Podés retomar el agendamiento cuando lo necesites. ¿En qué más te puedo ayudar?",
              "booking-flow-exit"
            )
            await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
            return
          }

          if (bookingResult.type === "needs_new_date_search") {
            bookingLogger.info("Nueva búsqueda de turnos por fechas", {
              fechaDesde: bookingResult.fechaDesde,
              fechaHasta: bookingResult.fechaHasta,
              description: bookingResult.description,
            })
            try {
              const currentBookingStateForSearch = await getBookingFlowState(userPhoneNumber, config.id)
              const searchResult = await obtenerTurnos(
                config.cliente_id,
                bookingResult.fechaDesde,
                bookingResult.fechaHasta,
                currentBookingStateForSearch?.profesionalId,
                undefined,
                false,
                currentBookingStateForSearch?.sedeId,
                currentBookingStateForSearch?.especialidadId,
                currentBookingStateForSearch?.obraSocialId,
              )

              let newOptions = mapApiTurnosToOptions(searchResult.datos ?? searchResult)

              if (newOptions.length === 0 && currentBookingStateForSearch) {
                // Sin resultados: conservar lista anterior y avisar
                const noResultMsg = `No encontré turnos disponibles para ${bookingResult.description}.\n\n¿Querés intentar con otras fechas o elegir de la lista anterior?`
                await sendDirectResponse(bookingCtx, noResultMsg, "booking-flow-new-search")
              } else {
                // Guardar nuevas opciones en state
                if (currentBookingStateForSearch) {
                  await setBookingFlowState(userPhoneNumber, config.id, {
                    ...currentBookingStateForSearch,
                    step: "awaiting_turno_selection",
                    turnoOptions: newOptions,
                    fullTurnoOptions: currentBookingStateForSearch.fullTurnoOptions ?? currentBookingStateForSearch.turnoOptions,
                  })
                }
                const newListMsg = buildNewDateSearchTurnoListMessage(
                  newOptions,
                  bookingResult.description,
                  config.displayName
                )
                await sendDirectResponse(bookingCtx, newListMsg, "booking-flow-new-search")
              }
            } catch (searchErr) {
              bookingLogger.error("Error en nueva búsqueda de turnos por fechas", searchErr as Error)
              await sendDirectResponse(bookingCtx, "Hubo un problema al buscar turnos. Por favor intentá de nuevo.", "booking-flow-new-search-error")
            }
            await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
            return
          }
        }
      }
    }

    // ============================================================================
    // INTERCEPTAR SELECCION DE TURNO (Sprint 4: Selección de Turnos por Número)
    // Si hay un estado awaiting_turn_selection activo, resolver directamente
    // ============================================================================
    if (message.type === "text" || message.type === "interactive") {
      const turnFlags = await getEffectiveFeatureFlags(config.id)
      if (turnFlags.directTurnSelection) {
        const turnResult = await handleTurnSelectionIfPending(userMessage, userPhoneNumber, config.id)
        if (turnResult.handled) {
          const turnLogger = createConversationLogger(userPhoneNumber, config.id, "awaiting_turn_selection")
          const turnCtx: DirectResponseContext = {
            phoneNumberId: value.metadata.phone_number_id,
            accessToken: config.accessToken,
            userPhoneNumber,
            configId: config.id,
            clienteId: config.cliente_id,
          }

          if (turnResult.type === "invalid_selection") {
            // Número fuera de rango
            turnLogger.warn("Seleccion fuera de rango", { maxTurnos: turnResult.maxTurnos })
            const errMsg = buildInvalidSelectionMessage(turnResult.maxTurnos)
            await sendDirectResponse(turnCtx, errMsg, "awaiting_turn_selection")
            return
          }

          if (turnResult.type === "turn_selected") {
            // Turno seleccionado correctamente - mostrar detalle y opciones
            turnLogger.info("Turno seleccionado, enviando detalle y opciones de accion", {
              turno: turnResult.turno.fecha,
            })
            const selectedMsg = buildTurnSelectedMessage(turnResult.turno)
            await sendDirectResponse(turnCtx, selectedMsg, "awaiting_turn_selection")
            return
          }
        }
      }
    }

    // ============================================================================
    // INTERCEPTAR DESPEDIDAS (Sprint 3: Anti-Repetición)
    // SOLO si hay un recordatorio previo (contexto de turno), responder directamente
    // Si NO hay recordatorio previo, SIEMPRE pasar a OpenAI
    // ============================================================================
    if (message.type === "text") {
      const flags = await getEffectiveFeatureFlags(config.id)
      if (flags.antiRepetitionFarewell) {
        const farewellLogger = createConversationLogger(userPhoneNumber, config.id, "farewell-check")
        
        // Verificar si hay contexto de turno (indica que hubo un recordatorio previo)
        const chatbotDataForFarewell = await getAppointmentContext(userPhoneNumber, config.id)
        
        // SOLO procesar directamente si hay recordatorio previo
        if (chatbotDataForFarewell) {
          const patientName = chatbotDataForFarewell.paciente?.nombres || "amigo"
          
          const farewellResponse = await handleFarewellIfDetected(
            userMessage,
            userPhoneNumber,
            config.id,
            patientName
          )
          
          if (farewellResponse) {
            // Es una despedida - responder directamente sin OpenAI
            farewellLogger.info("Despedida interceptada (con recordatorio previo), respondiendo directamente", { 
              response: farewellResponse 
            })
            
            try {
              const farewellCtx: DirectResponseContext = {
                phoneNumberId: value.metadata.phone_number_id,
                accessToken: config.accessToken,
                userPhoneNumber,
                configId: config.id,
                clienteId: config.cliente_id,
              }
              await sendDirectResponse(farewellCtx, farewellResponse, "farewell")
              return
            } catch (error) {
              farewellLogger.error("Error enviando respuesta de despedida", error as Error)
              // Fallback: continuar a OpenAI
            }
          } else {
            farewellLogger.debug("No es una despedida, pasando a OpenAI")
          }
        } else {
          farewellLogger.debug("Sin recordatorio previo, pasando a OpenAI (no se procesa directamente)")
        }
      }
    }

    // ============================================================================
    // AI DISPATCHER (Sprint 60) — Capa híbrida de inteligencia
    // Solo activo cuando aiDispatcher flag está ON.
    // Si toma una decisión, ejecuta el handler correcto y retorna.
    // Si no (error / passthrough), cae al enqueueUserMessage normal.
    // ============================================================================
    if (message.type === "text") {
      const dispatcherFlags = await getEffectiveFeatureFlags(config.id)
      if (dispatcherFlags.aiDispatcher) {
        try {
          const dispatcherLogger = createConversationLogger(userPhoneNumber, config.id, "ai-dispatcher")

          // Obtener contexto de turno e historial en paralelo (antes: secuencial)
          const [dispatcherAppCtx, dispatcherHistory] = await Promise.all([
            getAppointmentContext(userPhoneNumber, config.id).catch(() => null),
            import('./conversation-state/conversation-history')
              .then(m => m.getHistory(userPhoneNumber))
              .then(msgs => msgs.map((m: any) => `${m.role === 'user' ? 'Paciente' : 'Bot'}: ${m.content}`).join('\n'))
              .catch(() => ''),
          ])

          // Construir contexto completo del paciente
          // (buildDispatcherContext ya paraleliza sus propias lecturas Redis internamente)
          const dispatcherCtx = await buildDispatcherContext(
            userPhoneNumber,
            config.id,
            dispatcherAppCtx,
            dispatcherHistory
          )

          // Llamar al dispatcher (GPT-4o-mini con function calling)
          const dispatcherResult = await runAIDispatcher(
            userPhoneNumber,
            config.id,
            userMessage,
            dispatcherCtx
          )

          if (dispatcherResult.handled) {
            const executorDeps: ExecutorDeps = {
              phoneNumber: userPhoneNumber,
              configId: config.id,
              clienteId: config.cliente_id,
              escalationPhone: config.escalationPhoneNumber,
            }

            const execResult = await executeDispatcherDecision(dispatcherResult, dispatcherCtx, executorDeps)
            dispatcherLogger.info('[Dispatcher] Acción ejecutada', { action: execResult.action.type, note: execResult.logNote })

            const dispatcherCtxDirect: DirectResponseContext = {
              phoneNumberId: value.metadata.phone_number_id,
              accessToken: config.accessToken,
              userPhoneNumber,
              configId: config.id,
              clienteId: config.cliente_id,
            }

            const action = execResult.action

            if (action.type === 'send_and_return') {
              await sendDirectResponse(dispatcherCtxDirect, action.message, "ai-dispatcher")
              await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
              return
            }

            if (action.type === 'init_patient_detection') {
              const detResult = await initializePatientDetection(
                userPhoneNumber, config.id, config.cliente_id, config.displayName
              )
              if (detResult?.handled && detResult.message) {
                await sendDirectResponse(dispatcherCtxDirect, detResult.message, "ai-dispatcher-menu")
              }
              await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
              return
            }

            if (action.type === 'init_existing_patient_flow') {
              const patient = dispatcherCtx.patient
              const initialMsg = action.slots?.profesional
                ? `Necesito turno con ${action.slots.profesional}`
                : action.slots?.especialidad
                  ? `Necesito turno de ${action.slots.especialidad}`
                  : undefined
              const existingResult = await initializeExistingPatientFlow(
                userPhoneNumber,
                '',  // patientId — se recupera durante el flujo desde la API
                patient.name ?? '',
                patient.dni ?? '',
                undefined,
                config.cliente_id,
                undefined,
                config.escalationPhoneNumber,
                initialMsg
              )
              if (existingResult?.handled && existingResult.message) {
                await sendExistingPatientResult(dispatcherCtxDirect, existingResult, "ai-dispatcher-existing")
              }
              await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
              return
            }

            if (action.type === 'trigger_confirm_appointment') {
              if (dispatcherAppCtx) {
                const confirmMsg = buildConfirmationMessage(dispatcherAppCtx, 0)
                await sendDirectResponse(dispatcherCtxDirect, confirmMsg, "ai-dispatcher-confirm")
              }
              await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
              return
            }

            if (action.type === 'trigger_cancel_menu') {
              // Mostrar menú de cancelación — reutilizar template existente
              const { buildCancelConfirmationPrompt } = await import('./conversation-state/direct-confirmation-handler')
              const turno = dispatcherCtx.turnos[0]
              const turnoDetails = turno
                ? `📅 ${turno.fecha} a las ${turno.hora}\n👨‍⚕️ ${turno.profesional}\n📍 ${turno.sede}`
                : "Tu turno programado"
              const cancelMsg = buildCancelConfirmationPrompt(turnoDetails)
              await sendDirectResponse(dispatcherCtxDirect, cancelMsg, "ai-dispatcher-cancel")
              await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
              return
            }

            if (action.type === 'trigger_cancel_and_rebook') {
              // Mostrar prompt de cancelación — igual que trigger_cancel_menu.
              // Después de la cancelación, el dispatcher interceptará el próximo mensaje
              // de reserva y lo enrutará a iniciar_reserva_turno automáticamente.
              const { buildCancelConfirmationPrompt } = await import('./conversation-state/direct-confirmation-handler')
              const turno = dispatcherCtx.turnos[0]
              const turnoDetails = turno
                ? `📅 ${turno.fecha} a las ${turno.hora}\n👨‍⚕️ ${turno.profesional}\n📍 ${turno.sede}`
                : "Tu turno programado"
              const cancelMsg = buildCancelConfirmationPrompt(turnoDetails)
              await sendDirectResponse(dispatcherCtxDirect, cancelMsg, "ai-dispatcher-cancel-rebook")
              await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
              return
            }

            if (action.type === 'init_new_patient_flow') {
              // Para pacientes nuevos sin DNI previo, iniciar flujo de detección.
              // Si el DNI ingresado no existe en el sistema, patient-detection
              // derivará automáticamente al flujo de paciente nuevo.
              const detResult = await initializePatientDetection(
                userPhoneNumber, config.id, config.cliente_id, config.displayName
              )
              if (detResult?.handled && detResult.message) {
                await sendDirectResponse(dispatcherCtxDirect, detResult.message, "ai-dispatcher-new-patient")
              }
              await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
              return
            }

            if (action.type === 'continue_active_flow') {
              // El mensaje es una respuesta válida al flujo activo.
              // Según el flujo activo, delegar al handler correspondiente.
              const flowType = dispatcherCtx.activeFlow.type
              if (flowType === 'existing_patient') {
                const existRes = await handleExistingPatientMessage(
                  userPhoneNumber, userMessage, config.cliente_id,
                  config.escalationPhoneNumber,
                  {
                    enableSearchByProfessional: config.enableSearchByProfessional !== false,
                    enableSearchBySpecialty: config.enableSearchBySpecialty !== false,
                    enableSearchByAnyDoctor: config.enableSearchByAnyDoctor !== false,
                  }
                )
                if (existRes?.handled && existRes.message) {
                  await sendExistingPatientResult(dispatcherCtxDirect, existRes, "ai-dispatcher-continue-existing")
                }
                await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
                return
              }
              if (flowType === 'new_patient') {
                const newRes = await handleNewPatientMessage(
                  userPhoneNumber, userMessage, config.cliente_id, config.escalationPhoneNumber
                )
                if (newRes?.handled && newRes.message) {
                  await sendDirectResponse(dispatcherCtxDirect, newRes.message, "ai-dispatcher-continue-new")
                }
                await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
                return
              }
              if (flowType === 'patient_detection') {
                const detRes = await handlePatientDetectionMessage(
                  userPhoneNumber, userMessage, config.id, config.cliente_id,
                  config.displayName, config.escalationPhoneNumber
                )
                if (detRes?.handled && detRes.message) {
                  await sendDirectResponse(dispatcherCtxDirect, detRes.message, "ai-dispatcher-continue-detection")
                }
                await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
                return
              }
              // Sin flujo activo reconocido: mostrar menú principal
              const noFlowResult = await initializePatientDetection(
                userPhoneNumber, config.id, config.cliente_id, config.displayName
              )
              if (noFlowResult?.handled && noFlowResult.message) {
                await sendDirectResponse(dispatcherCtxDirect, noFlowResult.message, "ai-dispatcher-no-flow-menu")
              }
              await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
              return
            }

            // action.type === 'passthrough' → con dispatcher activo, mostrar menú principal
            // en lugar de caer a OpenAI (que puede inventar información incorrecta)
            if (action.type === 'passthrough') {
              createConversationLogger(userPhoneNumber, config.id, "ai-dispatcher")
                .info('[Dispatcher] Passthrough — mostrando menú principal')
              const passthroughResult = await initializePatientDetection(
                userPhoneNumber, config.id, config.cliente_id, config.displayName
              )
              if (passthroughResult?.handled && passthroughResult.message) {
                await sendDirectResponse(dispatcherCtxDirect, passthroughResult.message, "ai-dispatcher-passthrough-menu")
              }
              await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
              return
            }
          }
        } catch (dispatcherError) {
          createConversationLogger(userPhoneNumber, config.id, "ai-dispatcher")
            .error('[Dispatcher] Error crítico — mostrando menú principal como fallback', dispatcherError as Error)
          // Con dispatcher activo, ante error mostramos el menú en lugar de caer a OpenAI
          try {
            const errorCtxDirect: DirectResponseContext = {
              phoneNumberId: value.metadata.phone_number_id,
              accessToken: config.accessToken,
              userPhoneNumber,
              configId: config.id,
              clienteId: config.cliente_id,
            }
            const errorResult = await initializePatientDetection(
              userPhoneNumber, config.id, config.cliente_id, config.displayName
            )
            if (errorResult?.handled && errorResult.message) {
              await sendDirectResponse(errorCtxDirect, errorResult.message, "ai-dispatcher-error-menu")
            }
            await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
            return
          } catch {
            // Si incluso el fallback falla, caer al enqueue como último recurso
          }
        }
      }
    }

    // Encolar el mensaje para procesamiento secuencial por usuario
    await enqueueUserMessage(userPhoneNumber, {
      userMessage,
      messageType: message.type,
      phoneNumberId: value.metadata.phone_number_id,
      config,
      audioId,
      audioMimeType,
    })

  } catch (error) {
    console.error("[WHATSAPP] Error al procesar el mensaje:", (error as Error).message)
  }
}

// Función para procesar un mensaje individual (llamada desde la cola)
export async function processIndividualMessage(
  userMessage: string,
  phoneNumberId: string,
  config: any,
  userPhoneNumber: string,
  messageType = "text",
  audioId?: string,
  audioMimeType?: string,
  routeToReagendamiento?: boolean,
  functionArgs?: any,
) {

  try {
    // ============================================================================
    // MANEJO ESPECIAL PARA REAGENDAMIENTO (FLUJO DETERMINISTICO)
    // ============================================================================
    if (routeToReagendamiento && functionArgs) {

      // Verificar feature flag para usar flujo determinístico
      const rescheduleFlags = await getFeatureFlagsForReschedule(config.id)
      
      if (rescheduleFlags.directReagendamiento) {
        
        try {
          // Obtener turnos disponibles del mismo profesional y sede
          const { buscarTurnosDisponibles } = await import("./api-tools/api-functions")
          
          // Extraer datos del turno cancelado
          const turnoData = functionArgs.turno_cancelado
          const pacienteData = functionArgs.paciente
          
          
          // Verificar que tenemos los IDs necesarios
          if (!turnoData.profesional_id || !turnoData.sede_id) {
            console.error(`[WHATSAPP] Faltan IDs para buscar turnos:`, {
              profesional_id: turnoData.profesional_id,
              sede_id: turnoData.sede_id,
            })
            // Fallback al flujo legacy de OpenAI
          } else {
            const today = new Date()
            const formatDate = (date: Date) => date.toISOString().split("T")[0]
            const primerNombre = pacienteData.nombres.split(" ")[0]

            // Helper: buscar turnos con el mismo profesional, sede y DNI del paciente
            const buscarConRango = async (dias: number) => {
              const hasta = new Date(today)
              hasta.setDate(today.getDate() + dias)
              const rango = `${formatDate(today)} a ${formatDate(hasta)}`
              const resp = await buscarTurnosDisponibles(
                rango,
                undefined,
                undefined,
                turnoData.profesional_id,
                config.cliente_id,
                turnoData.sede_id,
                pacienteData.dni,  // Filtra por obra social del paciente
              )
              if (!resp.exito) return []

              // El proxy puede devolver los turnos agrupados por fecha
              // ([{ fecha, turnos: [...] }]) o como lista directa. Aplanamos y
              // normalizamos al formato TurnoDisponible (campos en minúscula) que
              // espera el flujo de reagendamiento; de lo contrario formatTime(hora)
              // recibe undefined y lanza "Cannot read properties of undefined (reading 'length')".
              const raw: any[] = resp.datos?.turnos_disponibles || resp.datos || []
              const planos: any[] = []
              for (const item of raw) {
                if (item && Array.isArray(item.turnos)) {
                  planos.push(...item.turnos)
                } else if (item) {
                  planos.push(item)
                }
              }

              const formatFechaAr = (fechaStr: string): string => {
                if (!fechaStr) return ""
                const [y, m, d] = fechaStr.split("-")
                return y && m && d ? `${d}/${m}/${y}` : fechaStr
              }

              return planos.map((t: any) => {
                const fecha = t.Fecha || t.fecha || ""
                const horaRaw = (t.Hora || t.hora || t.hora_formateada || "").toString()
                const horaCorta = horaRaw.trim().substring(0, 5)
                return {
                  id: t.Id || t.id || t.Agenda_Id || t.agenda_id || "",
                  fecha,
                  fecha_formateada: t.fecha_formateada || formatFechaAr(fecha),
                  hora: horaRaw,
                  hora_formateada: t.hora_formateada || horaCorta,
                  profesional:
                    t.Profesional_Nombre || t.profesional || t.profesional_nombre || turnoData.profesional || "",
                  profesional_id: t.Profesional_Id || t.profesional_id || turnoData.profesional_id || "",
                  sede: t.Sede_Nombre || t.sede || t.sede_nombre || turnoData.sede || "",
                  direccion: t.Direccion || t.direccion || "",
                  agenda_id: t.Id || t.id || t.Agenda_Id || t.agenda_id || "",
                  disponibilidad: 1,
                }
              })
            }

            // Búsqueda progresiva: 14 días → 30 días → 60 días
            for (const dias of [14, 30, 60]) {
              const turnos = await buscarConRango(dias)
              if (Array.isArray(turnos) && turnos.length > 0) {
                // Pasar chatbotData completo (con turno_cancelado) para que startRescheduleFlow
                // tenga el contexto correcto al construir el estado del flujo
                const chatbotDataParaReschedule = await getAppointmentContext(userPhoneNumber, config.id)
                const result = await startRescheduleFlow(
                  chatbotDataParaReschedule || ({ paciente: pacienteData, turnos: [] } as any),
                  turnos,
                  phoneNumberId,
                  config.accessToken,
                  userPhoneNumber,
                  config.id,
                  config.cliente_id
                )
                if (result.handled) {
                  await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
                  return
                }
              }
            }

            // Sin turnos en los próximos 60 días → mostrar menú de búsqueda ampliada
            const { buildNoTurnosConProfesionalMessage, buildNoTurnosSaveSearchTypeState } =
              await import("./conversation-state/reschedule-templates")
            const noTurnosMsg = buildNoTurnosConProfesionalMessage(
              primerNombre,
              turnoData.profesional
            )
            await sendDirectResponse(
              { phoneNumberId, accessToken: config.accessToken, userPhoneNumber, configId: config.id, clienteId: config.cliente_id },
              noTurnosMsg,
              "reagendamiento-no-turnos"
            )

            // Guardar estado awaiting_search_type con datos del paciente y turno cancelado
            await buildNoTurnosSaveSearchTypeState(
              userPhoneNumber,
              config.id,
              turnoData,
              pacienteData
            )
            return
          }
          
        } catch (error) {
          console.error(`[WHATSAPP] Error en flujo determinístico de reagendamiento:`, (error as Error).message)
          // Fallback al flujo de OpenAI si hay error
        }
      }
      
      // ========================================================================
      // FLUJO LEGACY (OpenAI) - Se usa si flag OFF o como fallback
      // ========================================================================

      try {
        const openai = new (await import("openai")).default({
          apiKey: process.env.OPENAI_API_KEY,
        })

        // Obtener el thread actual (puede no existir si el usuario llegó por template)
        const threadInfo = await getThreadForUser(userPhoneNumber, config.id)


        const newThread = await openai.beta.threads.create({
          metadata: {
            name: `whatsapp-${userPhoneNumber}-${config.id}`,
            previousThread: threadInfo?.threadId || "none",
            reason: "assistant_switch_reagendamiento",
          },
        })


        // Actualizar en base de datos
        const { updateThreadId } = await import("./db")
        const reAgendAssistantId = config.whatsappReagendamientoAssistantId
        
        if (reAgendAssistantId) {
          await updateThreadId(userPhoneNumber, config.id, newThread.id, reAgendAssistantId)
        }

        // Crear mensaje de sistema con los datos del turno cancelado
        const { formatScheduleForSystemBlock: formatSchedule } = await import("./utils/schedule-formatter")
        const { getArgentinaDateTime: getArgentinaDT } = await import("./utils/date-utils")
        const fechaHora = getArgentinaDT()
        const scheduleInfo = formatSchedule(config)

        const systemBlock = `[SISTEMA]
Nombre: ${config.displayName}
FechaHora: ${fechaHora}
PrimerMensaje: true
TipoMensaje: assistant_switch
PacienteCelular: ${userPhoneNumber}${config.escalationPhoneNumber ? `\nNumeroDerivacion: ${config.escalationPhoneNumber}` : ""}
FuncionOrigen: route_to_reagendamiento${scheduleInfo}
[/SISTEMA]

${JSON.stringify(functionArgs, null, 2)}`

        await openai.beta.threads.messages.create(newThread.id, {
          role: "user",
          content: systemBlock,
        })


        // Trackear inicio de reagendamiento
        if (config.cliente_id) {
          const { trackRescheduleStarted } = await import("./appointment-stats")
          await trackRescheduleStarted(config.cliente_id, userPhoneNumber)
        }

        // Llamar a getAssistantResponse con el nuevo thread y assistantId
        if (reAgendAssistantId) {
          await getAssistantResponse(
            newThread.id,
            "Hola, quisiera reagendar mi turno.",
            phoneNumberId,
            reAgendAssistantId,
            userPhoneNumber,
          )
        } else {
          console.error(`[WHATSAPP] No se encontró whatsappReagendamientoAssistantId en config`)
          await sendWhatsAppMessage(
            phoneNumberId,
            config.accessToken,
            userPhoneNumber,
            "Lo siento, el asistente de reagendamiento no está configurado. Por favor, contacta con soporte."
          )
        }

        await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
        return
      } catch (error) {
        console.error(`[WHATSAPP] Error en reagendamiento:`, (error as Error).message)
        await sendWhatsAppMessage(
          phoneNumberId,
          config.accessToken,
          userPhoneNumber,
          "Lo siento, hubo un error al iniciar el proceso de reagendamiento. Por favor, intenta nuevamente."
        )
        await updateWhatsAppStats(config.id, { errors: 1 })
        return
      }
    }

    // ============================================================================
    // INTERCEPTOR: FLUJO DE REAGENDAMIENTO ACTIVO
    // ============================================================================
    // Si el usuario está en medio de un flujo de reagendamiento determinístico,
    // procesar el mensaje con el handler determinístico
    const rescheduleActive = await isRescheduleFlowActive(userPhoneNumber, config.id)
    if (rescheduleActive) {
      
      const rescheduleResult = await processRescheduleMessage(
        userMessage,
        phoneNumberId,
        config.accessToken,
        userPhoneNumber,
        config.id,
        config.cliente_id
      )
      
      if (rescheduleResult.handled) {
        // Guardar el mensaje del usuario antes de salir
        await saveConversationMessage({
          id: nanoid(),
          role: "user",
          content: userMessage,
          timestamp: new Date().toISOString(),
          phoneNumber: userPhoneNumber,
          configId: config.id,
        })
        await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
        return
      }
      
      // Si necesita fallback a OpenAI para NLU, continuar con flujo normal
      if (rescheduleResult.fallbackToOpenAI && rescheduleResult.fallbackContext) {
        // El flujo normal (asst_router) se encarga del procesamiento libre
      }
    }

    // ============================================================================
    // PROCESAMIENTO NORMAL DE MENSAJES
    // ============================================================================
    if (messageType === "audio" && audioId) {

      try {
        const transcription = await transcribeWhatsAppAudio(audioId, config.accessToken, audioMimeType)

        if (transcription && transcription.trim()) {
          // Use the transcription as the user message
          userMessage = transcription
          // Continue processing as a normal text message
        } else {
          const errorMessage =
            "Lo siento, no pude entender el audio que enviaste. ¿Podrías intentar nuevamente o enviar tu mensaje por escrito?"

            await saveConversationMessage({
              id: nanoid(),
              role: "assistant",
              content: errorMessage,
              timestamp: new Date().toISOString(),
              phoneNumber: userPhoneNumber,
              configId: config.id,
              messageType: "error",
            })

          await sendWhatsAppMessage(phoneNumberId, config.accessToken, userPhoneNumber, errorMessage)
          await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
          return
        }
      } catch (transcriptionError) {
        console.error(`[WHATSAPP] ❌ Error transcribiendo audio:`, transcriptionError)

        const errorMessage =
          "Lo siento, hubo un problema al procesar tu mensaje de voz. ¿Podrías intentar nuevamente o enviar tu mensaje por escrito?"

        await saveConversationMessage({
          id: nanoid(),
          role: "assistant",
          content: errorMessage,
          timestamp: new Date().toISOString(),
          phoneNumber: userPhoneNumber,
          configId: config.id,
          messageType: "error",
        })

        await sendWhatsAppMessage(phoneNumberId, config.accessToken, userPhoneNumber, errorMessage)
        await updateWhatsAppStats(config.id, { errors: 1 })
        return
      }
    }

    if (messageType === "sticker" || messageType === "reaction") {
      // Update stats - message received but not processed
      await updateWhatsAppStats(config.id, { messagesReceived: 1 })
      return // Exit early, don't process or respond
    }

    // Obtener o crear un thread para este usuario
    let threadResult
    try {
      threadResult = await getThreadForUser(userPhoneNumber, config.id)
      if (threadResult.assistantId) {
      }
    } catch (error) {
      console.error("[WHATSAPP] Error al obtener thread ID:", (error as Error).message)

      const errorMessage =
        "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta de nuevo más tarde."

      try {
        await saveConversationMessage({
          id: nanoid(),
          role: "assistant",
          content: errorMessage,
          timestamp: new Date().toISOString(),
          phoneNumber: userPhoneNumber,
          configId: config.id,
          messageType: "error",
        })
      } catch (saveError) {
        console.error(`[WHATSAPP] ❌ Error guardando mensaje de error:`, saveError)
      }

      await sendWhatsAppMessage(phoneNumberId, config.accessToken, userPhoneNumber, errorMessage)
      // Actualizar estadísticas - error
      await updateWhatsAppStats(config.id, { errors: 1 })
      return
    }

    const scheduleInfo = formatScheduleForSystemBlock(config)

    let messageToSend = `[SISTEMA]
Nombre: ${config.displayName}
FechaHora: ${getArgentinaDateTime()}
PrimerMensaje: ${threadResult.isNewThread}
TipoMensaje: ${messageType}
PacienteCelular: ${userPhoneNumber}${config.escalationPhoneNumber ? `\nNumeroDerivacion: ${config.escalationPhoneNumber}` : ""}${scheduleInfo}
[/SISTEMA]

${userMessage}`

    // Si es un thread reseteado, indicarlo
    if (threadResult.isResetThread) {
      messageToSend = `[SISTEMA]
Nombre: ${config.displayName}
FechaHora: ${getArgentinaDateTime()}
PrimerMensaje: true
ThreadReseteado: true
TipoMensaje: ${messageType}
PacienteCelular: ${userPhoneNumber}${config.escalationPhoneNumber ? `\nNumeroDerivacion: ${config.escalationPhoneNumber}` : ""}${scheduleInfo}
[/SISTEMA]

${userMessage}`
    }


    const assistantToUse = threadResult.assistantId || config.whatsappAssistantId
    if (threadResult.assistantId) {
    } else {
    }

    // Obtener respuesta del asistente
    try {
      await getAssistantResponse(threadResult.threadId, messageToSend, phoneNumberId, assistantToUse, userPhoneNumber)


      // Actualizar estadísticas - mensaje procesado
      await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
    } catch (error) {
      console.error("[WHATSAPP] Error al obtener respuesta del asistente:", (error as Error).message)

      // Actualizar estadísticas - error
      await updateWhatsAppStats(config.id, { errors: 1 })

      // Si el error es 404 (thread no encontrado), intentar crear uno nuevo
      if ((error as any).status === 404 && (error as any).error?.type === "invalid_request_error") {
        try {
          // Crear un nuevo thread directamente con OpenAI
          const openai = new (await import("openai")).default({
            apiKey: process.env.OPENAI_API_KEY,
          })

          const newThread = await openai.beta.threads.create()

          // Actualizar en la base de datos
          const key = `thread:${userPhoneNumber}:${config.id}`
          const redisClient = getRedisClient()

          // Guardar el nuevo thread
          const threadInfo = {
            threadId: newThread.id,
            phoneNumber: userPhoneNumber,
            whatsappConfigId: config.id,
            lastMessageAt: new Date().toISOString(),
            messageCount: 1,
            isResetThread: true, // Añadir este flag para identificar que es un thread recién creado
          }

          if (redisClient) {
            await redisClient.set(key, JSON.stringify(threadInfo))
          }

          await getAssistantResponse(
            newThread.id,
            messageToSend,
            phoneNumberId,
            config.whatsappAssistantId,
            userPhoneNumber,
          )


          // Actualizar estadísticas - mensaje procesado
          await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
        } catch (retryError) {
          console.error("[WHATSAPP] Error al reintentar con nuevo thread:", retryError)

          const errorMessage =
            "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta de nuevo más tarde."

          try {
            await saveConversationMessage({
              id: nanoid(),
              role: "assistant",
              content: errorMessage,
              timestamp: new Date().toISOString(),
              phoneNumber: userPhoneNumber,
              configId: config.id,
              messageType: "error",
            })
          } catch (saveError) {
            console.error(`[WHATSAPP] ❌ Error guardando mensaje de error:`, (saveError as Error).message)
          }

          // Enviar mensaje de error al usuario
          try {
            await sendWhatsAppMessage(phoneNumberId, config.accessToken, userPhoneNumber, errorMessage)
          } catch (sendError) {
            console.error("[WHATSAPP] Error al enviar mensaje de error:", sendError)
          }
        }
      } else {
        const errorMessage =
          "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta de nuevo más tarde."

        try {
            await saveConversationMessage({
              id: nanoid(),
              role: "assistant",
              content: errorMessage,
              timestamp: new Date().toISOString(),
              phoneNumber: userPhoneNumber,
              configId: config.id,
              messageType: "error",
            })
        } catch (saveError) {
          console.error(`[WHATSAPP] �� Error guardando mensaje de error:`, saveError)
        }

        // Enviar mensaje de error al usuario
        try {
          await sendWhatsAppMessage(phoneNumberId, config.accessToken, userPhoneNumber, errorMessage)
        } catch (sendError) {
          console.error("[WHATSAPP] Error al enviar mensaje de error:", sendError)
        }
      }
    }

  } catch (error) {
    console.error(`[WHATSAPP] Error al procesar mensaje individual para usuario ${userPhoneNumber}:`, (error as Error).message)

    const errorMessage =
      "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta de nuevo más tarde."

    try {
        await saveConversationMessage({
          id: nanoid(),
          role: "assistant",
          content: errorMessage,
          timestamp: new Date().toISOString(),
          phoneNumber: userPhoneNumber,
          configId: config.id,
          messageType: "error",
        })
    } catch (saveError) {
      console.error(`[WHATSAPP] ❌ Error guardando mensaje de error:`, saveError)
    }

    // Enviar mensaje de error al usuario
    try {
      await sendWhatsAppMessage(phoneNumberId, config.accessToken, userPhoneNumber, errorMessage)
    } catch (sendError) {
      console.error("[WHATSAPP] Error al enviar mensaje de error:", sendError)
    }
  }
}
