import { getWhatsAppConfigByPhoneId, updateWhatsAppStats, getThreadForUser, resetThreadForUser, clearThreadAssistantId, clearAllConversationStates } from "@/lib/db"
import { sendWhatsAppMessage } from "@/lib/whatsapp-api"
import { transcribeWhatsAppAudio } from "@/lib/audio-transcription"
import { getAssistantResponse } from "@/lib/openai-tools"
import { getArgentinaDateTime } from "@/lib/utils/date-utils"
import { normalizePhoneNumber } from "@/lib/utils"
import { getRedisClient } from "./redis"
import { enqueueUserMessage } from "./user-queue"
import { saveConversationMessage, isConversationPaused, type ConversationMessage } from "./conversations"
import { nanoid } from "nanoid"
import { TIMEOUTS, fetchWithRetry } from "./config/timeouts"
import { trackAppointmentEvent, getTemplateSentTime, checkAndTrackUserInitiated, markPendingReschedule } from "./appointment-stats"
import { getActiveSessionByPhone, addPendingMessageToSession, saveSupportMessage } from "./human-support"
import type { HumanSupportMessage } from "./types"
import { formatScheduleForSystemBlock } from "./utils/schedule-formatter"
import {
  getAppointmentContext,
  saveAppointmentContext,
  getFlowState,
  setFlowState,
  clearFlowState,
  isConfirmCancelResponse,
  isKeepAppointmentResponse,
  isRescheduleChoice,
  type ChatbotData,
  type ChatbotDataTurno,
} from "./appointment-flow-state"
import {
  buildConfirmationMessage,
  buildCancelDoubleConfirmMessage,
  buildCancellationSuccessMessage,
  buildKeepAppointmentMessage,
  buildNoRescheduleMessage,
  buildRescheduleStartMessage,
  buildAlreadyCancelledMessage,
} from "./direct-response-templates"
import { createConversationLogger } from "./conversation-state/logger"
import { getEffectiveFeatureFlags } from "./conversation-state/feature-flags"
import { handleFarewellIfDetected, detectFarewellPreFlow, detectReciprocalFarewellPreFlow } from "./conversation-state/farewell-handler"
import { detectWrongNumberPreFlow, setWrongPersonState } from "./conversation-state/wrong-number-handler"
import { detectDirectConfirmationPreFlow, buildConfirmationSuccessResponse, buildCancelConfirmationPrompt } from "./conversation-state/direct-confirmation-handler"
import { detectInformationalQueryPreFlow } from "./conversation-state/informational-query-handler"
import { detectPostActionContextPreFlow, savePostActionContext } from "./conversation-state/post-action-context"
import { detectNLUFallbackPreFlow } from "./conversation-state/nlu-fallback-handler"
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
  buildBookingContextBlock,
} from "./conversation-state/booking-flow-handler"
import {
  startRescheduleFlow,
  processRescheduleMessage,
  isRescheduleFlowActive,
  RESCHEDULE_NLU_ASSISTANT_ID,
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
} from "./conversation-state/patient-detection/patient-flow-integration"
import {
  initializeMultiPatientFlow,
  handleTargetDNIInput,
  handleTargetNameInput,
  isMultiPatientFlowActive,
  getTargetPatientInfo,
  clearMultiPatientFlow,
} from "./conversation-state/shared/multi-patient-handler"
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
// Import dynamic handleAssistantSwitch
let handleAssistantSwitch: any = null

// Función para extraer el contenido del mensaje según su tipo
function extractMessageContent(message: any): { content: string; audioId?: string; audioMimeType?: string } {
  switch (message.type) {
    case "text":
      return { content: message.text?.body || "" }
    case "button":
      return { content: message.button?.text || message.button?.payload || "" }
    case "interactive":
      if (message.interactive?.type === "button_reply") {
        return { content: message.interactive.button_reply?.title || message.interactive.button_reply?.id || "" }
      } else if (message.interactive?.type === "list_reply") {
        return { content: message.interactive.list_reply?.title || message.interactive.list_reply?.id || "" }
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
    console.log(`[WHATSAPP] Mensaje ${messageId} marcado como procesado`)
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

    await updateWhatsAppStats(ctx.configId, { messagesProcessed: 1 })

    logger.info("Respuesta directa enviada", { messageLength: message.length })
    return true
  } catch (error) {
    logger.error("Error enviando respuesta directa", error as Error)
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

  // Obtener contexto del turno
  const chatbotData = await getAppointmentContext(userPhoneNumber, config.id)
  if (!chatbotData) {
    logger.warn("No hay contexto de turno, pasando a OpenAI")
    await clearFlowState(userPhoneNumber, config.id)
    return false
  }

  // Manejar segun el tipo de flujo
  if (flowState.type === 'awaiting_cancel_confirmation') {
    // Usuario responde a "1- Si, cancelar" / "2- No, mantener"
    if (isConfirmCancelResponse(userMessage)) {
      console.log(`[WHATSAPP-DIRECT] Usuario confirma cancelacion`)
      
      // Llamar al proxy para ejecutar la cancelacion
      try {
        const proxyPayload = {
          action: "template_response",
          Cliente_Id: config.cliente_id,
          Phone_Number_Id: phoneNumberId,
          // Simular estructura de boton de cancelacion
          messages: [{
            type: "button",
            button: {
              text: "Cancelar",
              payload: "Cancelar"
            }
          }],
          metadata: {
            phone_number_id: phoneNumberId
          },
          contacts: value.contacts || []
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

        if (response.ok) {
          if (config.cliente_id) {
            const templateSentAt = await getTemplateSentTime(config.cliente_id, userPhoneNumber)
            await trackAppointmentEvent({
              clienteId: config.cliente_id,
              phoneNumber: userPhoneNumber,
              eventType: "cancelled",
              timestamp: new Date().toISOString(),
              templateSentAt: templateSentAt || undefined,
              metadata: { source: "direct_flow" },
            })
            await markPendingReschedule(config.cliente_id, userPhoneNumber)
          }

          await clearFlowState(userPhoneNumber, config.id)

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
          return true
        } else {
          logger.error("Error del proxy al cancelar", undefined, { status: response.status })
          await clearFlowState(userPhoneNumber, config.id)
          return false
        }
      } catch (error) {
        logger.error("Error al cancelar via proxy", error as Error)
        await clearFlowState(userPhoneNumber, config.id)
        return false
      }
    } else if (isKeepAppointmentResponse(userMessage)) {
      logger.info("Usuario decide mantener turno")
      await clearFlowState(userPhoneNumber, config.id)
      const keepMsg = buildKeepAppointmentMessage(chatbotData, flowState.turnoIndex || 0)
      await sendDirectResponse(ctx, keepMsg, "awaiting_cancel_confirmation")
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
        
        // action === "abandon_flow" o fallback
        logger.info("NLU: abandonando flujo", { reason: contextualResult.reasoning })
        await clearFlowState(userPhoneNumber, config.id)
        return false
      }
      
      // Sin NLU contextual, comportamiento original
      logger.info("Respuesta no reconocida, pasando a OpenAI", { userMessage })
      await clearFlowState(userPhoneNumber, config.id)
      return false
    }
  } else if (flowState.type === 'awaiting_reschedule_choice') {
    const choice = isRescheduleChoice(userMessage)
    
    if (choice === 'reschedule') {
      logger.info("Usuario quiere reagendar - switch a asistente de reagendamiento")
      await clearFlowState(userPhoneNumber, config.id)
      return {
        type: 'route_to_reagendamiento',
        chatbotData,
        turnoIndex: flowState.turnoIndex || 0
      }
    } else if (choice === 'no_reschedule') {
      logger.info("Usuario no quiere reagendar")
      await clearFlowState(userPhoneNumber, config.id)
      const noRescheduleMsg = buildNoRescheduleMessage(chatbotData)
      await sendDirectResponse(ctx, noRescheduleMsg, "awaiting_reschedule_choice")
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
  console.log("[WHATSAPP] Iniciando handleMessage con datos:", JSON.stringify(value, null, 2))

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
      console.log(`[WHATSAPP] ⚠️ Mensaje duplicado detectado: ${messageId}, ignorando`)
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

    console.log(`[WHATSAPP] Procesando mensaje de ${userPhoneNumber}: "${userMessage}" (tipo: ${message.type})${audioId ? ` [audioId: ${audioId}]` : ""}`)

    // Ignorar stickers, reacciones e iconos (mensajes de texto compuestos únicamente por emojis)
    if (message.type === "sticker" || message.type === "reaction") {
      console.log(`[WHATSAPP] Ignorando mensaje de tipo "${message.type}" de ${userPhoneNumber}`)
      return
    }

    if (message.type === "text" && userMessage && /^[\p{Emoji}\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u.test(userMessage.trim()) && !/\w/.test(userMessage)) {
      console.log(`[WHATSAPP] Ignorando mensaje de texto con solo emojis/iconos de ${userPhoneNumber}: "${userMessage}"`)
      return
    }

    // Obtener la configuración de WhatsApp
    console.log(`[WHATSAPP] Buscando configuración para phone_number_id: ${value.metadata.phone_number_id}`)
    const config = await getWhatsAppConfigByPhoneId(value.metadata.phone_number_id)

    if (!config) {
      console.error(
        `[WHATSAPP] Configuración no encontrada para el número de teléfono ID: ${value.metadata.phone_number_id}`,
      )
      return
    }

    console.log(`[WHATSAPP] Configuración encontrada: ${config.displayName} (ID: ${config.id})`)

    // Verificar si es una conversación user-initiated (sin template o fuera de ventana 24h)
    // Solo verificar si hay cliente_id configurado para el tracking de estadísticas
    if (config.cliente_id) {
      const isUserInitiated = await checkAndTrackUserInitiated(config.cliente_id, userPhoneNumber)
      if (isUserInitiated) {
        console.log(`[WHATSAPP] Conversación USER-INITIATED registrada para ${userPhoneNumber}`)
      }
    }

    // ============================================================================
    // INTERCEPTAR RESPUESTAS DE FLUJOS PENDIENTES (doble confirmacion cancelacion, etc)
    // Esto permite responder directamente sin pasar por OpenAI
    // ============================================================================
    if (message.type === "text" || message.type === "button") {
      const flowResult = await handlePendingFlowResponse(
        userMessage,
        userPhoneNumber,
        config,
        value.metadata.phone_number_id,
        value
      )
      
      // Si fue true, la respuesta fue manejada completamente
      if (flowResult === true) {
        console.log(`[WHATSAPP] Mensaje manejado por flujo directo, no se pasa a OpenAI`)
        // Guardar el mensaje del usuario antes de salir (el bot ya guardó su respuesta)
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
      
      // Si fue un objeto especial (reagendamiento), hacer el switch
      if (flowResult && typeof flowResult === 'object' && flowResult.type === 'route_to_reagendamiento') {
        console.log(`[WHATSAPP] Detectado reagendamiento - haciendo switch al asistente de reagendamiento`)
        
        // Guardar el mensaje del usuario (eligió reagendar)
        await saveConversationMessage({
          id: nanoid(),
          role: "user",
          content: userMessage,
          timestamp: new Date().toISOString(),
          phoneNumber: userPhoneNumber,
          configId: config.id,
        })
        
        // Obtener el thread actual y el run ID para pasarlos a handleAssistantSwitch
        const threadInfo = await getThreadForUser(userPhoneNumber, config.id)
        if (!threadInfo || !threadInfo.threadId) {
          console.error(`[WHATSAPP] No se encontró thread para hacer el switch a reagendamiento`)
          // Fallback: enviar mensaje de error
          await sendWhatsAppMessage(
            value.metadata.phone_number_id,
            config.accessToken,
            userPhoneNumber,
            "Lo siento, hubo un error al iniciar el proceso de reagendamiento. Por favor, intenta nuevamente."
          )
          return
        }

        try {
          // Importar handleAssistantSwitch dinámicamente
          if (!handleAssistantSwitch) {
            const openaiTools = await import("./openai-tools")
            // handleAssistantSwitch es una función interna no exportada, acceder a través del módulo
            // Tenemos que llamar directamente dentro de processIndividualMessage
          }

          // Preparar los argumentos para route_to_reagendamiento con los datos del turno
          const turno = flowResult.chatbotData.turnos[flowResult.turnoIndex]
          const functionArgs = {
            paciente: {
              nombres: flowResult.chatbotData.paciente.nombres,
              apellido: flowResult.chatbotData.paciente.apellido,
              dni: flowResult.chatbotData.paciente.dni,
              telefono: flowResult.chatbotData.paciente.telefono,
            },
            turno_cancelado: {
              fecha: turno.fecha,
              hora: turno.hora_formateada,
              profesional: turno.profesional,
              profesional_id: turno.profesional_id,
              sede: turno.sede,
              sede_id: flowResult.chatbotData.sede_id,
              direccion: turno.direccion,
              agenda_id: turno.agenda_id,
            },
          }

          console.log(`[WHATSAPP] Encolando mensaje de reagendamiento con datos de turno cancelado`)

          // Encolar el mensaje con información especial de reagendamiento
          await enqueueUserMessage(userPhoneNumber, {
            userMessage: `[SISTEMA_REAGENDAMIENTO]${JSON.stringify(functionArgs)}[/SISTEMA_REAGENDAMIENTO]`,
            messageType: "text",
            phoneNumberId: value.metadata.phone_number_id,
            config,
            audioId: undefined,
            audioMimeType: undefined,
            routeToReagendamiento: true, // Flag especial para processIndividualMessage
            functionArgs, // Datos a pasar al asistente de reagendamiento
          })

          console.log(`[WHATSAPP] Mensaje de reagendamiento encolado exitosamente`)
          return
        } catch (error) {
          console.error(`[WHATSAPP] Error en flujo de reagendamiento:`, (error as Error).message)
          // Fallback: enviar mensaje de error
          await sendWhatsAppMessage(
            value.metadata.phone_number_id,
            config.accessToken,
            userPhoneNumber,
            "Lo siento, hubo un error al iniciar el proceso de reagendamiento. Por favor, intenta nuevamente."
          )
          return
        }
      }
    }

    const activeSession = await getActiveSessionByPhone(config.id, userPhoneNumber)

    if (activeSession) {
      console.log(`[WHATSAPP] 🆘 Usuario tiene sesión de soporte activa: ${activeSession.id} (${activeSession.status})`)

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
        console.log(`[WHATSAPP] ⏳ Sesión pendiente, guardando mensaje para cuando se asigne agente`)

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
        console.log(`[WHATSAPP] 👤 Sesión activa con agente, guardando mensaje en historial de soporte`)

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

    const conversationPaused = await isConversationPaused(config.id, userPhoneNumber)
    if (conversationPaused) {
      console.log(`[WHATSAPP] ⏸️ Conversación pausada para ${userPhoneNumber} en config ${config.id}, mensaje ignorado`)
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

    if (message.type === "button" && message.button) {
      console.log(
        `[WHATSAPP] Detectada respuesta de botón: ${message.button.text} (payload: ${message.button.payload})`,
      )

      // Detectar si es un botón de cancelación
      const buttonText = (message.button.text || "").toLowerCase()
      const buttonPayload = (message.button.payload || "").toLowerCase()
      const isCancellationButton = buttonText.includes("cancelar") || buttonPayload.includes("cancel")
      
      // IMPORTANTE: Limpiar el assistantId del thread para volver al asistente principal
      // Esto es necesario porque las respuestas de botón vienen de templates externos (recordatorios)
      // y no deben ser procesadas por asistentes especializados (ej: agendamiento)
      console.log(`[WHATSAPP] 🔄 Limpiando assistantId del thread para volver al asistente principal...`)
      const cleared = await clearThreadAssistantId(userPhoneNumber, config.id)
      if (cleared) {
        console.log(`[WHATSAPP] ✅ AssistantId limpiado - se usará el asistente principal`)
      } else {
        console.log(`[WHATSAPP] ℹ️ No había assistantId personalizado para limpiar`)
      }

      // Si es cancelación, intentar respuesta directa primero
      if (isCancellationButton) {
        console.log(`[WHATSAPP] Botón de CANCELACIÓN detectado`)
        
        // Intentar respuesta directa con datos del contexto guardado
        const chatbotData = await getAppointmentContext(userPhoneNumber, config.id)
        
        if (chatbotData) {
          console.log(`[WHATSAPP-DIRECT] Contexto de turno encontrado, usando respuesta directa para cancelación`)
          
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
            console.log(`[WHATSAPP-DIRECT] Doble confirmación de cancelación enviada, esperando respuesta del usuario`)
            return // Salir, no pasar a OpenAI
          } else {
            console.log(`[WHATSAPP-DIRECT] Error enviando respuesta directa, cayendo a OpenAI`)
            await clearFlowState(userPhoneNumber, config.id)
          }
        } else {
          console.log(`[WHATSAPP-DIRECT] No hay contexto de turno guardado, usando flujo OpenAI`)
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
        console.log(`[WHATSAPP] Botón de CONFIRMACIÓN/REPROGRAMACIÓN detectado - enviando al proxy`)
        
      let proxyResponse = null
      try {
        const proxyPayload = {
          action: "template_response",
          Cliente_Id: config.cliente_id,
          Phone_Number_Id: value.metadata.phone_number_id,
          ...value, // Enviar toda la estructura de WhatsApp
        }

        console.log(`[WHATSAPP] Enviando al proxy: ${config.proxy}`)
        console.log(`[WHATSAPP] Payload del proxy:`, JSON.stringify(proxyPayload, null, 2))

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

        console.log(`[WHATSAPP] Respuesta del proxy - Status: ${response.status}`)
        console.log(`[WHATSAPP] Respuesta del proxy - StatusText: ${response.statusText}`)

        if (response.ok) {
          const responseText = await response.text()
          console.log(`[WHATSAPP] Respuesta del proxy - Body:`, responseText)
          console.log(`[WHATSAPP] Respuesta de botón enviada al proxy exitosamente`)

          // Parsear la respuesta del proxy para enviarla a OpenAI
          try {
            proxyResponse = JSON.parse(responseText)
          } catch (parseError) {
            console.error(`[WHATSAPP] Error al parsear respuesta del proxy:`, parseError)
            proxyResponse = { success: false, error: "PARSE_ERROR", raw: responseText }
          }
        } else {
          const errorText = await response.text()
          console.error(`[WHATSAPP] Error al enviar respuesta de botón al proxy: ${response.status} - ${errorText}`)
          proxyResponse = { success: false, error: "PROXY_ERROR", status: response.status, message: errorText }
        }
      } catch (error) {
        console.error(`[WHATSAPP] Error al enviar respuesta de botón al proxy:`, error)
        console.error(`[WHATSAPP] Error details:`, {
          message: (error as Error).message,
          stack: (error as Error).stack,
          name: (error as Error).name,
        })
        proxyResponse = { success: false, error: "NETWORK_ERROR", message: (error as Error).message }
      }

      // Modificar el mensaje para incluir la respuesta del proxy de forma más específica
      if (proxyResponse) {
        console.log(`[WHATSAPP] Procesando respuesta del proxy:`, JSON.stringify(proxyResponse, null, 2))

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
                  console.log(`[WHATSAPP] Evento de confirmación registrado para cliente ${config.cliente_id}`)
                }

                // Intentar respuesta directa con datos del contexto guardado
                const chatbotDataConfirm = await getAppointmentContext(userPhoneNumber, config.id)
                if (chatbotDataConfirm) {
                  console.log(`[WHATSAPP-DIRECT] Contexto encontrado, usando respuesta directa para confirmación`)
                  
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
                    console.log(`[WHATSAPP-DIRECT] Confirmación enviada directamente, no se pasa a OpenAI`)
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
          console.log(`[WHATSAPP] Evento de cancelación registrado para cliente ${config.cliente_id}`)
          
          // Marcar que hay una cancelación pendiente de reagendar (ventana de 12h)
          await markPendingReschedule(config.cliente_id, userPhoneNumber)
          console.log(`[WHATSAPP] 📊 Marcado pending reschedule para ${userPhoneNumber}`)
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
                  console.log(`[WHATSAPP] Evento de reprogramación registrado para cliente ${config.cliente_id}`)
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

            console.log(
              `[WHATSAPP] 📊 Proxy respondió sin action_type, detectando acción desde botón: ${accionDetectada}`,
            )
            console.log(`[WHATSAPP] 📊 config.cliente_id disponible: ${config.cliente_id || "NO DISPONIBLE"}`)
            console.log(`[WHATSAPP] 📊 userPhoneNumber: ${userPhoneNumber}`)

            if (config.cliente_id) {
              console.log(`[WHATSAPP] 📊 Intentando obtener templateSentAt para cliente ${config.cliente_id}`)
              const templateSentAt = await getTemplateSentTime(config.cliente_id, userPhoneNumber)
              console.log(`[WHATSAPP] 📊 templateSentAt obtenido: ${templateSentAt || "NO ENCONTRADO"}`)

              let eventType: "confirmed" | "cancelled" | "rescheduled"
              if (accionDetectada === "confirmacion") {
                eventType = "confirmed"
              } else if (accionDetectada === "cancelacion") {
                eventType = "cancelled"
                // Marcar que hay una cancelación pendiente de reagendar (ventana de 12h)
                await markPendingReschedule(config.cliente_id, userPhoneNumber)
                console.log(`[WHATSAPP] 📊 Marcado pending reschedule para ${userPhoneNumber} desde botón`)
              } else {
                eventType = "rescheduled"
              }

              console.log(`[WHATSAPP] 📊 Registrando evento: ${eventType} para cliente ${config.cliente_id}`)

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
                console.log(
                  `[WHATSAPP] ✅ Evento ${eventType} registrado exitosamente para cliente ${config.cliente_id}`,
                )
                
                // Si es confirmación, intentar respuesta directa si el flag está activo
                if (eventType === "confirmed") {
                  const confirmFlags = await getEffectiveFeatureFlags(config.id)
                  const confirmLogger = createConversationLogger(userPhoneNumber, config.id, "awaiting_confirmation")
                  
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
                        return
                      }
                    } else {
                      confirmLogger.warn("directConfirmation ON pero no hay chatbotData, pasando a OpenAI")
                    }
                  } else {
                    confirmLogger.info("directConfirmation flag OFF, pasando a OpenAI")
                  }
                }
              } catch (trackError) {
                console.error(`[WHATSAPP] ❌ Error al registrar evento de estadísticas:`, trackError)
              }
            } else {
              console.log(
                `[WHATSAPP] ⚠️ No se registró evento - cliente_id: ${config.cliente_id || "VACÍO"}, accion: ${accionDetectada}`,
              )
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
            console.log(`[WHATSAPP] ✅ ALREADY_CONFIRMED detectado - tratando como éxito`)

            if (config.cliente_id) {
              await trackAppointmentEvent({
                clienteId: config.cliente_id,
                phoneNumber: userPhoneNumber,
                eventType: "confirmed",
                timestamp: new Date().toISOString(),
                templateSentAt: templateSentAt || undefined,
                metadata: { proxyResponse },
              })
              console.log(`[WHATSAPP] Evento de confirmación registrado (ya estaba confirmado) para cliente ${config.cliente_id}`)
            }
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
                console.log(`[WHATSAPP] Evento de confirmación registrado (ya estaba confirmado) para cliente ${config.cliente_id}`)
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
        console.log(`[WHATSAPP] Procesando comando de reset para el usuario ${userPhoneNumber}`)

        // 1. Resetear el thread de OpenAI
        const resetResult = await resetThreadForUser(userPhoneNumber, config.id)
        console.log(`[WHATSAPP] ✅ Thread reseteado exitosamente`)
        console.log(`[WHATSAPP] - Nuevo thread ID: ${resetResult.threadId}`)
        console.log(`[WHATSAPP] - isNewThread: ${resetResult.isNewThread}`)

        // 2. Limpiar TODOS los estados de conversación en Redis
        const clearResult = await clearAllConversationStates(userPhoneNumber, config.id)
        console.log(`[WHATSAPP] ✅ Estados de conversación limpiados`)
        console.log(`[WHATSAPP] - Keys limpiadas: ${clearResult.clearedKeys.length}`)
        if (clearResult.clearedKeys.length > 0) {
          console.log(`[WHATSAPP] - Detalle: ${clearResult.clearedKeys.join(', ')}`)
        }
        if (clearResult.errors.length > 0) {
          console.warn(`[WHATSAPP] ⚠️ Errores al limpiar: ${clearResult.errors.join(', ')}`)
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

        console.log(`[WHATSAPP] ✅ Reset completado y confirmación enviada`)
        return // Importante: salir de la función después de procesar el reset
      } catch (error) {
        console.error("[WHATSAPP] ❌ Error al resetear conversación:", error)
        console.error("[WHATSAPP] Error details:", {
          message: (error as Error).message,
          stack: (error as Error).stack,
        })

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
          console.log(`[WHATSAPP] 💾 Mensaje de error de reset guardado en conversación`)
        } catch (saveError) {
          console.error(`[WHATSAPP] ❌ Error guardando mensaje de error:`, saveError)
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
        console.log(`[WHATSAPP] 🤫 Verificando respuesta recíproca a despedida para ${userPhoneNumber}`)
        
        const reciprocalResult = await detectReciprocalFarewellPreFlow(
          userMessage,
          userPhoneNumber,
          config.id
        )
        
        if (reciprocalResult.shouldSilence) {
          console.log(`[WHATSAPP] 🤫 Respuesta recíproca detectada, aplicando SILENCIO: ${reciprocalResult.reason}`)
          
          // Trackear evento para analytics
          await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
          
          // NO enviar ninguna respuesta - silencio total
          return
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
        console.log(`[WHATSAPP] 📝 Verificando confirmación/cancelación directa para ${userPhoneNumber}`)
        
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
            console.log(`[WHATSAPP] ✅ Confirmación directa detectada, procesando confirmación`)
            
            // Enviar confirmación al proxy
            const confirmCtx: DirectResponseContext = {
              phoneNumberId: value.metadata.phone_number_id,
              accessToken: config.accessToken,
              userPhoneNumber,
              configId: config.id,
              clienteId: config.cliente_id,
            }
            
            // Procesar confirmación igual que botón "Confirmar"
            const confirmResponse = buildConfirmationSuccessResponse(patientName)
            await sendDirectResponse(confirmCtx, confirmResponse, "direct_confirm")
            
            // Enviar evento al proxy para confirmar el turno
            try {
              const proxyUrl = appointmentCtx.proxyUrl || process.env.CHATBOT_PROXY_URL
              if (proxyUrl && appointmentCtx.appointment_id) {
                await fetchWithRetry(
                  `${proxyUrl}/api/chatbot/confirmar`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      appointment_id: appointmentCtx.appointment_id,
                      phone: userPhoneNumber,
                    }),
                  },
                  { timeoutMs: TIMEOUTS.PROXY_CONFIRM, retries: 2 }
                )
                console.log(`[WHATSAPP] ✅ Turno ${appointmentCtx.appointment_id} confirmado en proxy`)
                
                // Trackear evento
                await trackAppointmentEvent({
                  clienteId: config.cliente_id,
                  phoneNumber: userPhoneNumber,
                  eventType: "template_confirmed",
                  timestamp: new Date().toISOString(),
                  appointmentId: String(appointmentCtx.appointment_id),
                  metadata: { method: "direct_text" },
                })
              }
            } catch (proxyError) {
              console.error("[WHATSAPP] Error enviando confirmación al proxy:", proxyError)
            }
            
            await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
            return
          }
          
          if (directActionResult.action === "cancel") {
            console.log(`[WHATSAPP] ⚠️ Cancelación directa detectada, iniciando doble confirmación`)
            
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
        console.log(`[WHATSAPP] 📍 Verificando consulta informativa para ${userPhoneNumber}`)
        
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
          console.log(`[WHATSAPP] ✅ Consulta informativa detectada (${infoQueryResult.queryType}), respondiendo directamente`)
          
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
        console.log(`[WHATSAPP] 📝 Verificando contexto post-acción para ${userPhoneNumber}`)
        
        const postActionResult = await detectPostActionContextPreFlow(
          userMessage,
          userPhoneNumber,
          config.id,
          true // useNLU para casos ambiguos
        )
        
        if (postActionResult.detected) {
          console.log(`[WHATSAPP] ✅ Mensaje post-acción detectado (${postActionResult.intent})`)
          
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
        console.log(`[WHATSAPP] 👋 Verificando despedida pre-flujo para ${userPhoneNumber}`)
        
        const farewellResult = await detectFarewellPreFlow(
          userMessage,
          userPhoneNumber,
          config.id,
          true // useNLU para casos ambiguos
        )
        
        if (farewellResult.isFarewell && farewellResult.response) {
          console.log(`[WHATSAPP] ✅ Despedida detectada, respondiendo sin iniciar flujo`)
          
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
        console.log(`[WHATSAPP] 📞 Verificando numero equivocado para ${userPhoneNumber}`)
        
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
          console.log(`[WHATSAPP] ✅ Numero equivocado detectado, respondiendo con disculpa`)
          
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
      console.log(`[WHATSAPP] 🧠 Verificando NLU fallback router para ${userPhoneNumber}`)
      
      // Obtener el appointmentContext si existe
      const appointmentData = await getAppointmentContext(userPhoneNumber, config.id)
      
      const nluFallbackResult = await detectNLUFallbackPreFlow(
        userPhoneNumber,
        userMessage,
        config.id,
        appointmentData,
        undefined, // conversationHistory - puede agregarse después si es necesario
        config.escalationPhoneNumber // Número de derivación para consultas que no podemos responder
      )
      
      if (nluFallbackResult.shouldHandle && nluFallbackResult.response) {
        console.log(`[WHATSAPP] ✅ NLU fallback detectó intención: ${nluFallbackResult.result?.intent}, respondiendo`)
        
        const nluCtx: DirectResponseContext = {
          phoneNumberId: value.metadata.phone_number_id,
          accessToken: config.accessToken,
          userPhoneNumber,
          configId: config.id,
          clienteId: config.cliente_id,
        }
        
        await sendDirectResponse(nluCtx, nluFallbackResult.response, "nlu_fallback_response")
        
        // Si fue confirmación, actualizar stats
        if (nluFallbackResult.result?.intent === "confirmar_asistencia" && appointmentData) {
          await trackAppointmentEvent(config.cliente_id, userPhoneNumber, "direct_confirm", appointmentData.appointment_id)
        }
        
        // Si fue cancelación, marcar como confirmación para el flujo de cancelación
        if (nluFallbackResult.result?.intent === "cancelar_turno") {
          // Establecer flowState para esperar la doble confirmación de cancelación
          if (appointmentData?.appointment_id) {
            await setFlowState(userPhoneNumber, config.id, {
              state: "awaiting_cancel_confirmation",
              appointmentId: String(appointmentData.appointment_id),
              patientName: appointmentData.pacient_name || "Paciente",
              timestamp: Date.now(),
            })
          }
        }
        
        await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
        return
      }
    }
  }
  
    // ============================================================================
    // NEW: INTERCEPTAR DETECCION INICIAL DE PACIENTE (Sin recordatorio previo)
    // Sprint 9a-c: Nuevo flujo deterministico de deteccion e intake
    // ============================================================================
    if (message.type === "text") {
      // Verificar PRIMERO si hay flujo activo (el orden de prioridad debe ser correcto)
      // Esto evita reinicializar detección si ya hay un flujo en curso
      const isMultiPatientActive = await isMultiPatientFlowActive(userPhoneNumber)
      const isDetectionActive = await isPatientDetectionFlowActive(userPhoneNumber) ||
                               await isExistingPatientFlowActive(userPhoneNumber) || 
                               await isNewPatientFlowActive(userPhoneNumber)
      
      // Solo inicializar si NO hay flujo activo
      if (!isMultiPatientActive && !isDetectionActive) {
        const detectionFlags = await getEffectiveFeatureFlags(config.id)
        const hasPendingReminder = false // TODO: Verificar si hay recordatorio pendiente en el contexto
        const shouldDetect = await shouldUsePatientDetection(userPhoneNumber, config.cliente_id, hasPendingReminder)
        
        if (detectionFlags.directPatientDetection && shouldDetect) {
          console.log(`[WHATSAPP] 🔍 Iniciando detección de paciente para ${userPhoneNumber}`)
          
          // Inicializar detección
          const detectionResult = await initializePatientDetection(userPhoneNumber, config.id, config.cliente_id, config.displayName)
          
          if (detectionResult.handled) {
            console.log(`[WHATSAPP] ✅ Detección iniciada, enviando mensaje`)
            const detectionCtx: DirectResponseContext = {
              phoneNumberId: value.metadata.phone_number_id,
              accessToken: config.accessToken,
              userPhoneNumber,
              configId: config.id,
              clienteId: config.cliente_id,
            }
            
            await sendDirectResponse(detectionCtx, detectionResult.message || "", "initial_detection_pending")
            await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
            return
          }
        }
      }
    }

    // ============================================================================
    // INTERCEPTAR FLUJOS ACTIVOS: Detección inicial, Paciente Existente o Nuevo (Sprint 9a-c)
    // ============================================================================
    if (message.type === "text") {
      // Verificar si hay algún flujo activo de Sprint 9a, 9b, 9c o Sprint 30
      // IMPORTANTE: Verificar flujo multiusuario PRIMERO, antes de detección
      const isMultiPatientActive = await isMultiPatientFlowActive(userPhoneNumber)
      const isDetectionActive = await isPatientDetectionFlowActive(userPhoneNumber) ||
                               await isExistingPatientFlowActive(userPhoneNumber) ||
                               await isNewPatientFlowActive(userPhoneNumber)
      
      if (isMultiPatientActive || isDetectionActive) {
        const detectionFlags = await getEffectiveFeatureFlags(config.id)
        
        // Procesar mensaje durante detección
        let detectionResult = null
        
        if (isMultiPatientActive) {
          // Sprint 30: Flujo multiusuario (familiar) - VERIFICAR PRIMERO
          console.log(`[WHATSAPP] Procesando mensaje en flujo multiusuario (familiar)`)
          
          const multiPatientState = await getTargetPatientInfo(userPhoneNumber)
          if (!multiPatientState) {
            console.log(`[WHATSAPP] Estado del flujo multiusuario no encontrado`)
            detectionResult = { handled: false, shouldCallOpenAI: true }
          } else if (multiPatientState.phase === 'awaiting_target_dni') {
            // Usuario está ingresando el DNI del familiar
            const dniResult = await handleTargetDNIInput(
              userPhoneNumber,
              userMessage,
              config.cliente_id,
              config.id
            )
            
            if (dniResult.handled && dniResult.message) {
              await sendDirectResponse({ phoneNumberId: value.metadata.phone_number_id, accessToken: config.accessToken, userPhoneNumber, configId: config.id }, dniResult.message, "multi_patient_dni")
              
              // Si encontró paciente, continuar al flujo de paciente existente
              if (dniResult.action === 'patient_found' && dniResult.patientInfo) {
                const existingResult = await initializeExistingPatientFlow(
                  userPhoneNumber,
                  dniResult.patientInfo.patientId || '',
                  dniResult.patientInfo.patientName || '',
                  dniResult.patientInfo.patientDNI || '',
                  undefined,
                  config.cliente_id,
                  undefined,
                  config.escalationPhoneNumber,
                  true // isMultiPatientFlow = true
                )
                if (existingResult?.handled && existingResult.message) {
                  await sendDirectResponse({ phoneNumberId: value.metadata.phone_number_id, accessToken: config.accessToken, userPhoneNumber, configId: config.id }, existingResult.message, "existing_patient_flow")
                }
                await clearMultiPatientFlow(userPhoneNumber)
              }
              
              await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
              return
            }
          } else if (multiPatientState.phase === 'awaiting_target_name') {
            // Usuario está ingresando el nombre del familiar (paciente nuevo)
            const nameResult = await handleTargetNameInput(
              userPhoneNumber,
              userMessage,
              config.cliente_id,
              config.id
            )
            
            if (nameResult.handled && nameResult.message) {
              await sendDirectResponse({ phoneNumberId: value.metadata.phone_number_id, accessToken: config.accessToken, userPhoneNumber, configId: config.id }, nameResult.message, "multi_patient_name")
              
              // Si completó el nombre, continuar al flujo de paciente nuevo
              if (nameResult.patientInfo) {
                const newPatientResult = await initializeNewPatientFlow(
                  nameResult.patientInfo.patientDNI || '',
                  userPhoneNumber,
                  config.cliente_id
                )
                if (newPatientResult?.handled && newPatientResult.message) {
                  await sendDirectResponse({ phoneNumberId: value.metadata.phone_number_id, accessToken: config.accessToken, userPhoneNumber, configId: config.id }, newPatientResult.message, "new_patient_flow")
                }
                await clearMultiPatientFlow(userPhoneNumber)
              }
              
              await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
              return
            }
          }
        } else if (await isPatientDetectionFlowActive(userPhoneNumber)) {
          // Sprint 9a: Flujo de detección inicial (menú principal, desambiguación por DNI, etc.)
          console.log(`[WHATSAPP] Procesando mensaje en flujo de detección inicial (Sprint 9a)`)
          detectionResult = await handlePatientDetectionMessage(userPhoneNumber, userMessage, config.cliente_id)
        } else if (await isExistingPatientFlowActive(userPhoneNumber)) {
          console.log(`[WHATSAPP] Procesando mensaje en flujo de paciente existente`)
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
          console.log(`[WHATSAPP] Procesando mensaje en flujo de paciente nuevo`)
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
          const intentSelection = userMessage.trim().match(/^[1-2]$/)
          
          if (!intentSelection) {
            console.log(`[WHATSAPP] Selección de intención inválida: ${userMessage}`)
            await sendDirectResponse(
              detectionCtx,
              'Por favor, respondé con 1 o 2 según tu intención.',
              "contact_intent_invalid"
            )
            await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
            return
          }

          const selection = parseInt(intentSelection[0], 10)
          console.log(`[WHATSAPP] Intención seleccionada: ${selection === 1 ? 'Turno' : 'Consulta'}`)

          if (selection === 1) {
            // Opción 1: Solicitar turno — cambiar fase a awaiting_initial_response (pedir DNI)
            await updatePatientDetectionPhase(userPhoneNumber, 'awaiting_initial_response')
            const turnoConfirmMessage = await import('./conversation-state/patient-detection/patient-templates').then(
              m => m.buildTurnoIntentConfirmedMessage()
            )
            await sendDirectResponse(detectionCtx, turnoConfirmMessage, "contact_intent_turno")
            await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
            return
          } else if (selection === 2) {
            // Opción 2: Consulta — derivar teléfono y terminar flujo
            const escalationPhone = config.escalationPhoneNumber || 'nuestro equipo'
            const otherInquiryMessage = await import('./conversation-state/patient-detection/patient-templates').then(
              m => m.buildOtherInquiryMessage(config.escalationPhoneNumber, config.displayName)
            )
            await sendDirectResponse(detectionCtx, otherInquiryMessage, "contact_intent_consulta")
            await completePatientDetectionFlow(userPhoneNumber, config.id)
            await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
            return
          }
        }

        if (detectionResult?.action === 'new_patient_dni_pending') {
          // Paciente nuevo ingresó DNI — derivar al flujo de paciente nuevo
          const dniOnly = userMessage.trim().replace(/[^0-9]/g, '')
          console.log(`[WHATSAPP] DNI de paciente nuevo recibido, derivando a flujo nuevo`)
          const newPatientResult = await initializeNewPatientFlow(dniOnly, userPhoneNumber, config.cliente_id)
          if (newPatientResult?.handled && newPatientResult.message) {
            await sendDirectResponse(detectionCtx, newPatientResult.message, "new_patient_flow")
            await completePatientDetectionFlow(userPhoneNumber, config.id)
            await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
            return
          }
        }

        if (detectionResult?.handled) {
          if (detectionResult.message) {
            await sendDirectResponse(detectionCtx, detectionResult.message, "detection_flow")
          }

          // Cuando el paciente seleccionó una opción del menú inicial, derivar al flujo correcto
          // Type guard: solo PatientDetectionResult tiene action
          if ('action' in detectionResult && detectionResult.action && 'patientInfo' in detectionResult && detectionResult.patientInfo) {
            const patientInfo = detectionResult.patientInfo

            if (detectionResult.action === 'other_inquiry_intent') {
              // Paciente existente sin turnos eligió "Realizar otra consulta" → derivar a teléfono
              console.log(`[WHATSAPP] Paciente existente eligió "otra consulta" → derivando a teléfono`)
              const escalationPhone = config.escalationPhoneNumber || 'nuestro equipo'
              const otherInquiryMessage = await import('./conversation-state/patient-detection/patient-templates').then(
                m => m.buildOtherInquiryMessage(config.escalationPhoneNumber, config.displayName)
              )
              await sendDirectResponse(detectionCtx, otherInquiryMessage, "other_inquiry_existing_patient")
              await completePatientDetectionFlow(userPhoneNumber, config.id)
              await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
              return
            }

            if (detectionResult.action === 'book_family_appointment') {
              // Usuario seleccionó opción 3 "Solicitar turno para un familiar"
              console.log(`[WHATSAPP] Usuario seleccionó "turno para un familiar" → iniciando flujo multiusuario`)
              
              // Inicializar flujo de familiar
              const multiPatientResult = await initializeMultiPatientFlow(
                userPhoneNumber,
                patientInfo.patientName,
                patientInfo.patientDNI,
                patientInfo.patientId
              )
              
              if (multiPatientResult?.message) {
                await sendDirectResponse(detectionCtx, multiPatientResult.message, "multi_patient_flow")
              }
              
              // Limpiar detección pero mantener contexto de solicitante
              await completePatientDetectionFlow(userPhoneNumber, config.id)
              await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
              return
            }

            if (detectionResult.action === 'book_new_appointment' || detectionResult.action === 'other_inquiry') {
              // Verificar si ya hay un flujo de paciente existente activo y más avanzado
              const existingPhase = await getExistingPatientFlowPhase(userPhoneNumber)
              
              // Fases más avanzadas que awaiting_sede (ya pasaron la selección de sede)
              const advancedPhases = [
                'awaiting_search_type', 'awaiting_professional_name', 'awaiting_especialidad',
                'awaiting_turno_selection', 'awaiting_email', 'awaiting_confirmation'
              ]
              
              if (existingPhase && advancedPhases.includes(existingPhase)) {
                // Ya hay un flujo activo más avanzado - procesar el mensaje "1" en ese contexto
                console.log(`[WHATSAPP] Flujo de paciente existente ya activo en fase avanzada "${existingPhase}" → procesando mensaje en ese flujo`)
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
                  await sendDirectResponse(detectionCtx, existingResult.message, "existing_patient_flow")
                }
                await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
                return
              }
              
              // Derivar a flujo de paciente existente para reservar turno
              console.log(`[WHATSAPP] Acción "${detectionResult.action}" → iniciando flujo de paciente existente`)
              const existingResult = await initializeExistingPatientFlow(
                userPhoneNumber,
                patientInfo.patientId || '',
                patientInfo.patientName || '',
                '', // DNI vendrá del estado de detección
                undefined, // Email será ingresado por el usuario
                config.cliente_id,
                // No pasar additionalPatientData - serán recuperados del estado de detección en initializeExistingPatientFlow
                undefined,
                config.escalationPhoneNumber
              )
              if (existingResult?.handled && existingResult.message) {
                await sendDirectResponse(detectionCtx, existingResult.message, "existing_patient_flow")
              }
              
              // Limpiar estado de detección DESPUÉS de inicializar el flujo
              await completePatientDetectionFlow(userPhoneNumber, config.id)
            } else if (detectionResult.action === 'confirm_appointment' || detectionResult.action === 'cancel_appointment') {
              // Sprint 9a: Manejar confirmación/cancelación directamente con los turnos del paciente detectado
              console.log(`[WHATSAPP] Acción "${detectionResult.action}" → iniciando flujo directo`)
              
              // Verificar que tenemos turnos del paciente
              if (patientInfo?.turnos && patientInfo.turnos.length > 0) {
                const turno = patientInfo.turnos[0] // Usar el primer turno
                
                // Convertir el turno del flujo de detección al formato ChatbotData
                const chatbotData: ChatbotData = {
                  paciente: {
                    nombres: patientInfo.patientName || 'Paciente',
                    apellido: '',
                    dni: '',
                    telefono: userPhoneNumber,
                  },
                  turnos: patientInfo.turnos.map((t: any): ChatbotDataTurno => ({
                    fecha: t.Fecha || t.fecha,
                    fecha_formateada: t.Fecha || t.fecha,
                    hora: t.Hora || t.hora,
                    hora_formateada: (t.Hora || t.hora || '').substring(0, 5),
                    profesional: t.Profesional_Nombre || t.profesional || '',
                    profesional_id: t.Profesional_Id || t.profesional_id || '',
                    sede: t.Centro_Nombre || t.sede || '',
                    direccion: t.Direccion || t.direccion || '',
                    agenda_id: t.Agenda_Id || t.agenda_id || '',
                    admite_reagendamiento: t.admite_reagendamiento || false,
                    tipo: t.Motivo_Nombre || t.tipo || 'consulta',
                  })),
                  cantidad_turnos: patientInfo.turnos.length,
                  sede_id: turno.Sede_Id || turno.sede_id || '',
                  clinica: config.displayName || 'Clínica',
                  tipo_mensaje: 'user_initiated',
                }
                
                // Guardar el contexto para que el flujo de confirmación/cancelación lo use
                await saveAppointmentContext(userPhoneNumber, config.id, chatbotData)
                
                if (detectionResult.action === 'confirm_appointment') {
                  // Confirmar asistencia directamente
                  console.log(`[WHATSAPP] Confirmando turno directamente`)
                  const confirmMsg = buildConfirmationMessage(chatbotData, 0)
                  await sendDirectResponse(detectionCtx, confirmMsg, "confirm_flow")
                  
                  // Registrar evento de confirmación
                  await trackAppointmentEvent({
                    clienteId: config.cliente_id,
                    phoneNumber: userPhoneNumber,
                    eventType: 'confirmed',
                    metadata: { source: 'user_initiated_menu', turnoIndex: 0 }
                  })
                } else {
                  // Cancelación: mostrar doble confirmación
                  console.log(`[WHATSAPP] Iniciando flujo de cancelación con doble confirmación`)
                  
                  // Setear estado de flujo para esperar confirmación
                  await setFlowState(userPhoneNumber, config.id, {
                    type: 'awaiting_cancel_confirmation',
                    createdAt: new Date().toISOString(),
                    turnoIndex: 0
                  })
                  
                  // Construir y enviar mensaje de doble confirmación
                  const doubleConfirmMsg = buildCancelDoubleConfirmMessage(chatbotData, 0)
                  await sendDirectResponse(detectionCtx, doubleConfirmMsg, "cancel_flow")
                }
              } else {
                // Sin turnos - no debería pasar, pero por seguridad derivar a OpenAI
                console.log(`[WHATSAPP] Acción "${detectionResult.action}" sin turnos → derivando a OpenAI`)
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
    if (message.type === "text") {
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
        }
      }
    }

    // ============================================================================
    // INTERCEPTAR SELECCION DE TURNO (Sprint 4: Selección de Turnos por Número)
    // Si hay un estado awaiting_turn_selection activo, resolver directamente
    // ============================================================================
    if (message.type === "text") {
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

    // Encolar el mensaje para procesamiento secuencial por usuario
    console.log(`[WHATSAPP] Encolando mensaje para usuario ${userPhoneNumber}`)
    await enqueueUserMessage(userPhoneNumber, {
      userMessage,
      messageType: message.type,
      phoneNumberId: value.metadata.phone_number_id,
      config,
      audioId,
      audioMimeType,
    })

    console.log(`[WHATSAPP] Mensaje encolado exitosamente para usuario ${userPhoneNumber}`)
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
  console.log(
    `[WHATSAPP] Procesando mensaje individual para usuario ${userPhoneNumber}: "${userMessage}" (tipo: ${messageType})${audioId ? ` [audioId: ${audioId}]` : ""}`,
  )

  try {
    // ============================================================================
    // MANEJO ESPECIAL PARA REAGENDAMIENTO (FLUJO DETERMINISTICO)
    // ============================================================================
    if (routeToReagendamiento && functionArgs) {
      console.log(`[WHATSAPP] 🔄 Iniciando flujo de reagendamiento DETERMINISTICO`)

      // Verificar feature flag para usar flujo determinístico
      const rescheduleFlags = await getFeatureFlagsForReschedule(config.id)
      
      if (rescheduleFlags.directReagendamiento) {
        console.log(`[WHATSAPP] Flag directReagendamiento ON - Usando flujo determinístico`)
        
        try {
          // Obtener turnos disponibles del mismo profesional y sede
          const { buscarTurnosDisponibles } = await import("./api-tools/api-functions")
          
          // Extraer datos del turno cancelado
          const turnoData = functionArgs.turno_cancelado
          const pacienteData = functionArgs.paciente
          
          console.log(`[WHATSAPP] Datos del turno cancelado para reagendamiento:`, {
            profesional_id: turnoData.profesional_id,
            sede_id: turnoData.sede_id,
            profesional: turnoData.profesional,
            sede: turnoData.sede,
          })
          
          // Verificar que tenemos los IDs necesarios
          if (!turnoData.profesional_id || !turnoData.sede_id) {
            console.error(`[WHATSAPP] Faltan IDs para buscar turnos:`, {
              profesional_id: turnoData.profesional_id,
              sede_id: turnoData.sede_id,
            })
            // Fallback al flujo legacy de OpenAI
            console.log(`[WHATSAPP] Fallback a OpenAI por falta de IDs`)
          } else {
            // Calcular rango de fechas (próximos 14 días)
            const today = new Date()
            const futureDate = new Date(today)
            futureDate.setDate(today.getDate() + 14)
            const formatDate = (date: Date) => date.toISOString().split("T")[0]
            const rangoFechas = `${formatDate(today)} a ${formatDate(futureDate)}`
            
            console.log(`[WHATSAPP] Buscando turnos con rango: ${rangoFechas}`)
            
            // Buscar turnos disponibles para el mismo profesional
            // Firma: buscarTurnosDisponibles(rangoFechas, profesional, especialidad, profesionalId, clienteId, sedeId, ...)
            const turnosResponse = await buscarTurnosDisponibles(
              rangoFechas,           // rangoFechas (string "YYYY-MM-DD a YYYY-MM-DD")
              undefined,             // profesional (nombre, no necesario si tenemos ID)
              undefined,             // especialidad
              turnoData.profesional_id,  // profesionalId
              config.cliente_id,     // clienteId
              turnoData.sede_id,     // sedeId
            )
            
            console.log(`[WHATSAPP] Turnos disponibles encontrados:`, turnosResponse.datos?.length || 0)
            
            // Extraer turnos del response (puede venir en datos.turnos_disponibles o datos directamente)
            const turnosDisponibles = turnosResponse.exito 
              ? (turnosResponse.datos?.turnos_disponibles || turnosResponse.datos || [])
              : []
            
            if (Array.isArray(turnosDisponibles) && turnosDisponibles.length > 0) {
              // Iniciar flujo determinístico con los turnos encontrados
              const result = await startRescheduleFlow(
                {
                  paciente: pacienteData,
                  turnos: [], // No necesario para este flujo
                } as any,
                turnosDisponibles,
                phoneNumberId,
                config.accessToken,
                userPhoneNumber,
                config.id,
                config.cliente_id
              )
              
              if (result.handled) {
                console.log(`[WHATSAPP] Flujo de reagendamiento iniciado exitosamente`)
                await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
                return
              }
            }
            
            // Si no hay turnos disponibles, informar al usuario
            console.log(`[WHATSAPP] No hay turnos disponibles para reagendar`)
            await sendWhatsAppMessage(
              phoneNumberId,
              config.accessToken,
              userPhoneNumber,
              `Lo siento ${pacienteData.nombres.split(" ")[0]}, no hay turnos disponibles con el mismo profesional en este momento. Te recomendamos intentar más tarde o contactar a la clínica para más opciones.`
            )
            await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
            return
          }
          
        } catch (error) {
          console.error(`[WHATSAPP] Error en flujo determinístico de reagendamiento:`, (error as Error).message)
          // Fallback al flujo de OpenAI si hay error
          console.log(`[WHATSAPP] Fallback a OpenAI por error en flujo determinístico`)
        }
      }
      
      // ========================================================================
      // FLUJO LEGACY (OpenAI) - Se usa si flag OFF o como fallback
      // ========================================================================
      console.log(`[WHATSAPP] Usando flujo de reagendamiento con OpenAI (legacy)`)

      try {
        const openai = new (await import("openai")).default({
          apiKey: process.env.OPENAI_API_KEY,
        })

        // Obtener el thread actual
        const threadInfo = await getThreadForUser(userPhoneNumber, config.id)
        if (!threadInfo || !threadInfo.threadId) {
          console.error(`[WHATSAPP] No se encontró thread para reagendamiento`)
          await sendWhatsAppMessage(
            phoneNumberId,
            config.accessToken,
            userPhoneNumber,
            "Lo siento, hubo un error al procesar tu solicitud. Por favor, intenta nuevamente."
          )
          await updateWhatsAppStats(config.id, { errors: 1 })
          return
        }

        console.log(`[WHATSAPP] Creando nuevo thread para asistente de reagendamiento...`)

        const newThread = await openai.beta.threads.create({
          metadata: {
            name: `whatsapp-${userPhoneNumber}-${config.id}`,
            previousThread: threadInfo.threadId,
            reason: "assistant_switch",
          },
        })

        console.log(`[WHATSAPP] Nuevo thread creado: ${newThread.id}`)

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

        console.log(`[WHATSAPP] Mensaje de sistema enviado al nuevo thread`)

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
      console.log(`[WHATSAPP] Usuario en flujo de reagendamiento activo - procesando deterministicamente`)
      
      const rescheduleResult = await processRescheduleMessage(
        userMessage,
        phoneNumberId,
        config.accessToken,
        userPhoneNumber,
        config.id,
        config.cliente_id
      )
      
      if (rescheduleResult.handled) {
        console.log(`[WHATSAPP] Mensaje procesado por flujo de reagendamiento determinístico`)
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
      
      // Si necesita fallback a OpenAI para NLU
      if (rescheduleResult.fallbackToOpenAI && rescheduleResult.fallbackContext) {
        console.log(`[WHATSAPP] Fallback a OpenAI NLU para interpretar: ${rescheduleResult.fallbackContext.type}`)
        // TODO: Implementar llamada a asistente NLU (RESCHEDULE_NLU_ASSISTANT_ID)
        // Por ahora, continuar con flujo normal
      }
    }

    // ============================================================================
    // PROCESAMIENTO NORMAL DE MENSAJES
    // ============================================================================
    if (messageType === "audio" && audioId) {
      console.log(`[WHATSAPP] 🎤 Procesando mensaje de audio, iniciando transcripcion...`)

      try {
        const transcription = await transcribeWhatsAppAudio(audioId, config.accessToken, audioMimeType)

        if (transcription && transcription.trim()) {
          console.log(`[WHATSAPP] 🎤 Audio transcrito exitosamente: "${transcription.substring(0, 100)}..."`)
          // Use the transcription as the user message
          userMessage = transcription
          // Continue processing as a normal text message
        } else {
          console.log(`[WHATSAPP] 🎤 Transcripcion vacia, enviando mensaje de error`)
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
      console.log(`[WHATSAPP] �� Tipo de mensaje ${messageType} ignorado sin respuesta`)
      // Update stats - message received but not processed
      await updateWhatsAppStats(config.id, { messagesReceived: 1 })
      return // Exit early, don't process or respond
    }

    // Obtener o crear un thread para este usuario
    let threadResult
    try {
      console.log(`[WHATSAPP] Obteniendo thread para usuario ${userPhoneNumber} y config ${config.id}`)
      threadResult = await getThreadForUser(userPhoneNumber, config.id)
      console.log(`[WHATSAPP] Thread obtenido: ${threadResult.threadId}, isNewThread: ${threadResult.isNewThread}`)
      if (threadResult.assistantId) {
        console.log(`[WHATSAPP] 🤖 Thread tiene asistente personalizado: ${threadResult.assistantId}`)
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
        console.log(`[WHATSAPP] 💾 Mensaje de error de thread guardado en conversación`)
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

    console.log(`[WHATSAPP] Mensaje preparado para OpenAI:`, messageToSend)

    const assistantToUse = threadResult.assistantId || config.whatsappAssistantId
    if (threadResult.assistantId) {
      console.log(`[WHATSAPP] ✨ Usando asistente del thread: ${assistantToUse}`)
    } else {
      console.log(`[WHATSAPP] 🔵 Usando asistente por defecto: ${assistantToUse}`)
    }

    // Obtener respuesta del asistente
    try {
      console.log(`[v0] 📞 Antes de llamar getAssistantResponse:`, {
        userPhoneNumber,
        threadId: threadResult.threadId,
        phoneNumberId,
        assistantId: assistantToUse,
      })
      console.log(`[WHATSAPP] Llamando a getAssistantResponse...`)
      await getAssistantResponse(threadResult.threadId, messageToSend, phoneNumberId, assistantToUse, userPhoneNumber)

      console.log(`[WHATSAPP] getAssistantResponse completado exitosamente`)

      // Actualizar estadísticas - mensaje procesado
      await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
    } catch (error) {
      console.error("[WHATSAPP] Error al obtener respuesta del asistente:", (error as Error).message)

      // Actualizar estadísticas - error
      await updateWhatsAppStats(config.id, { errors: 1 })

      // Si el error es 404 (thread no encontrado), intentar crear uno nuevo
      if ((error as any).status === 404 && (error as any).error?.type === "invalid_request_error") {
        try {
          console.log("[WHATSAPP] Thread no encontrado, creando uno nuevo...")
          // Crear un nuevo thread directamente con OpenAI
          const openai = new (await import("openai")).default({
            apiKey: process.env.OPENAI_API_KEY,
          })

          const newThread = await openai.beta.threads.create()
          console.log(`[WHATSAPP] Nuevo thread creado: ${newThread.id}`)

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

          console.log(`[WHATSAPP] Reintentando con nuevo thread...`)
          console.log(`[v0] 📞 Antes de reintentar con nuevo thread:`, {
            userPhoneNumber,
            newThreadId: newThread.id,
            phoneNumberId,
            assistantId: config.whatsappAssistantId,
          })
          await getAssistantResponse(
            newThread.id,
            messageToSend,
            phoneNumberId,
            config.whatsappAssistantId,
            userPhoneNumber,
          )

          console.log(`[WHATSAPP] getAssistantResponse completado exitosamente con nuevo thread`)

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
            console.log(`[WHATSAPP] 💾 Mensaje de error de reintento guardado en conversación`)
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
          console.log(`[WHATSAPP] 💾 Mensaje de error general guardado en conversación`)
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

    console.log(`[WHATSAPP] Procesamiento individual completado para usuario ${userPhoneNumber}`)
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
      console.log(`[WHATSAPP] 💾 Mensaje de error catch guardado en conversación`)
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
