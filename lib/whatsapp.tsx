import type { WhatsAppValue } from "@/lib/types"
import { getWhatsAppConfigByPhoneId, updateWhatsAppStats, getThreadForUser, resetThreadForUser, clearThreadAssistantId } from "@/lib/db"
import { sendWhatsAppMessage } from "@/lib/whatsapp-api"
import { transcribeWhatsAppAudio } from "@/lib/audio-transcription"
import { getAssistantResponse } from "@/lib/openai-tools"
import { getArgentinaDateTime } from "@/lib/utils/date-utils"
import { normalizePhoneNumber } from "@/lib/utils"
import { getRedisClient } from "./redis"
import { enqueueUserMessage } from "./user-queue"
import { saveConversationMessage, isConversationPaused } from "./conversations"
import { nanoid } from "nanoid"
import { TIMEOUTS, fetchWithRetry } from "./config/timeouts"
import { trackAppointmentEvent, getTemplateSentTime, checkAndTrackUserInitiated, markPendingReschedule } from "./appointment-stats"
import { getActiveSessionByPhone, addPendingMessageToSession, saveSupportMessage } from "./human-support"
import type { HumanSupportMessage } from "./types"
import { formatScheduleForSystemBlock } from "./utils/schedule-formatter"
import {
  getAppointmentContext,
  getFlowState,
  setFlowState,
  clearFlowState,
  isConfirmCancelResponse,
  isKeepAppointmentResponse,
  isRescheduleChoice,
  type ChatbotData,
} from "./appointment-flow-state"
import {
  buildConfirmationMessage,
  buildCancelDoubleConfirmMessage,
  buildCancellationSuccessMessage,
  buildKeepAppointmentMessage,
  buildNoRescheduleMessage,
  buildRescheduleStartMessage,
} from "./direct-response-templates"

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
  message: string
): Promise<boolean> {
  try {
    // Enviar mensaje al usuario
    await sendWhatsAppMessage(
      ctx.phoneNumberId,
      ctx.accessToken,
      ctx.userPhoneNumber,
      message
    )

    // Guardar en historial
    await saveConversationMessage({
      id: nanoid(),
      role: "assistant",
      content: message,
      timestamp: new Date().toISOString(),
      phoneNumber: ctx.userPhoneNumber,
      configId: ctx.configId,
      messageType: "direct_response",
    })

    // Actualizar stats
    await updateWhatsAppStats(ctx.configId, { messagesProcessed: 1 })

    console.log(`[WHATSAPP-DIRECT] Respuesta directa enviada a ${ctx.userPhoneNumber}`)
    return true
  } catch (error) {
    console.error(`[WHATSAPP-DIRECT] Error enviando respuesta directa:`, error)
    return false
  }
}

/**
 * Maneja respuestas de doble confirmacion de cancelacion ("1"/"2")
 * Retorna true si la respuesta fue manejada, false si debe continuar al flujo normal
 */
async function handlePendingFlowResponse(
  userMessage: string,
  userPhoneNumber: string,
  config: any,
  phoneNumberId: string,
  value: any
): Promise<boolean> {
  // Verificar si hay un flujo pendiente
  const flowState = await getFlowState(userPhoneNumber, config.id)
  if (!flowState) return false

  console.log(`[WHATSAPP-DIRECT] Flujo pendiente detectado: ${flowState.type}`)

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
    console.log(`[WHATSAPP-DIRECT] No hay contexto de turno, pasando a OpenAI`)
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

        console.log(`[WHATSAPP-DIRECT] Enviando cancelacion al proxy`)
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
          // Trackear evento de cancelacion
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
            
            // Marcar pending reschedule
            await markPendingReschedule(config.cliente_id, userPhoneNumber)
          }

          // Limpiar estado de flujo
          await clearFlowState(userPhoneNumber, config.id)

          // Verificar si admite reagendamiento
          const turno = chatbotData.turnos[flowState.turnoIndex || 0]
          if (turno?.admite_reagendamiento !== false) {
            // Setear nuevo estado para reagendamiento
            await setFlowState(userPhoneNumber, config.id, {
              type: 'awaiting_reschedule_choice',
              createdAt: new Date().toISOString(),
              turnoIndex: flowState.turnoIndex || 0
            })
          }

          // Enviar mensaje de cancelacion exitosa
          const successMsg = buildCancellationSuccessMessage(chatbotData, flowState.turnoIndex || 0)
          await sendDirectResponse(ctx, successMsg)
          return true
        } else {
          console.error(`[WHATSAPP-DIRECT] Error del proxy al cancelar: ${response.status}`)
          // En caso de error, limpiar estado y pasar a OpenAI
          await clearFlowState(userPhoneNumber, config.id)
          return false
        }
      } catch (error) {
        console.error(`[WHATSAPP-DIRECT] Error al cancelar via proxy:`, error)
        await clearFlowState(userPhoneNumber, config.id)
        return false
      }
    } else if (isKeepAppointmentResponse(userMessage)) {
      console.log(`[WHATSAPP-DIRECT] Usuario decide mantener turno`)
      
      // Limpiar estado
      await clearFlowState(userPhoneNumber, config.id)
      
      // Enviar mensaje de turno mantenido
      const keepMsg = buildKeepAppointmentMessage(chatbotData, flowState.turnoIndex || 0)
      await sendDirectResponse(ctx, keepMsg)
      return true
    } else {
      // Respuesta no reconocida - limpiar estado y pasar a OpenAI
      console.log(`[WHATSAPP-DIRECT] Respuesta no reconocida: "${userMessage}", pasando a OpenAI`)
      await clearFlowState(userPhoneNumber, config.id)
      return false
    }
  } else if (flowState.type === 'awaiting_reschedule_choice') {
    // Usuario responde a "1- Reagendar" / "2- No reagendar"
    const choice = isRescheduleChoice(userMessage)
    
    if (choice === 'reschedule') {
      console.log(`[WHATSAPP-DIRECT] Usuario quiere reagendar`)
      await clearFlowState(userPhoneNumber, config.id)
      
      // Enviar mensaje de inicio de reagendamiento
      const rescheduleMsg = buildRescheduleStartMessage(chatbotData)
      await sendDirectResponse(ctx, rescheduleMsg)
      return true
    } else if (choice === 'no_reschedule') {
      console.log(`[WHATSAPP-DIRECT] Usuario no quiere reagendar`)
      await clearFlowState(userPhoneNumber, config.id)
      
      const noRescheduleMsg = buildNoRescheduleMessage(chatbotData)
      await sendDirectResponse(ctx, noRescheduleMsg)
      return true
    } else {
      // Respuesta no reconocida - limpiar y pasar a OpenAI
      console.log(`[WHATSAPP-DIRECT] Respuesta de reagendamiento no reconocida, pasando a OpenAI`)
      await clearFlowState(userPhoneNumber, config.id)
      return false
    }
  }

  return false
}

// Modificar la función handleMessage para usar la cola por usuario
export async function handleMessage(value: WhatsAppValue) {
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
      const handledByDirectFlow = await handlePendingFlowResponse(
        userMessage,
        userPhoneNumber,
        config,
        value.metadata.phone_number_id,
        value
      )
      if (handledByDirectFlow) {
        console.log(`[WHATSAPP] Mensaje manejado por flujo directo, no se pasa a OpenAI`)
        return
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
        messageType: message.type,
      })

      if (activeSession.status === "pending") {
        // Usuario aún esperando asignación - guardar mensaje como pendiente
        console.log(`[WHATSAPP] ⏳ Sesión pendiente, guardando mensaje para cuando se asigne agente`)

        await addPendingMessageToSession(activeSession.id, {
          id: nanoid(),
          role: "user",
          content: userMessage,
          timestamp: new Date().toISOString(),
          phoneNumber: userPhoneNumber,
          configId: config.id,
          messageType: message.type,
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
          from: "user",
          content: userMessage,
          timestamp: new Date().toISOString(),
          phoneNumber: userPhoneNumber,
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
        messageType: message.type,
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
      messageType: message.type,
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
Accion: El paciente ha presionado el botón de cancelación
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
          message: error.message,
          stack: error.stack,
          name: error.name,
        })
        proxyResponse = { success: false, error: "NETWORK_ERROR", message: error.message }
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
                
                // Si es confirmación, intentar respuesta directa
                if (eventType === "confirmed") {
                  const chatbotDataSimple = await getAppointmentContext(userPhoneNumber, config.id)
                  if (chatbotDataSimple) {
                    console.log(`[WHATSAPP-DIRECT] Usando respuesta directa para confirmación (sin action_type)`)
                    
                    const ctxSimple: DirectResponseContext = {
                      phoneNumberId: value.metadata.phone_number_id,
                      accessToken: config.accessToken,
                      userPhoneNumber,
                      configId: config.id,
                      clienteId: config.cliente_id,
                    }
                    
                    const confirmMsgSimple = buildConfirmationMessage(chatbotDataSimple, 0)
                    const sentSimple = await sendDirectResponse(ctxSimple, confirmMsgSimple)
                    
                    if (sentSimple) {
                      console.log(`[WHATSAPP-DIRECT] Confirmación enviada directamente`)
                      return // Salir, no pasar a OpenAI
                    }
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
            console.log(`[WHATSAPP] Error NOT_FOUND detectado, enviando mensaje directo sin OpenAI`)

            const errorMessage =
              "Lo siento, esta acción ya no está disponible. Es posible que el turno ya haya haya sido procesado o que la solicitud haya expirado. Si necesitas ayuda, por favor escribe tu consulta."

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
              console.log(`[WHATSAPP] 💾 Mensaje de error NOT_FOUND guardado en conversación`)
            } catch (saveError) {
              console.error(`[WHATSAPP] ❌ Error guardando mensaje de error:`, saveError)
            }
            // </CHANGE>

            // Send direct message to user
            try {
              await sendWhatsAppMessage(
                value.metadata.phone_number_id,
                config.accessToken,
                userPhoneNumber,
                errorMessage,
              )

              // Update stats - message processed
              await updateWhatsAppStats(config.id, { messagesProcessed: 1 })

              console.log(`[WHATSAPP] Mensaje directo enviado exitosamente para error NOT_FOUND`)
              return // Exit early, don't queue for OpenAI
            } catch (sendError) {
              console.error(`[WHATSAPP] Error al enviar mensaje directo para NOT_FOUND:`, sendError)
              // If sending fails, fall through to normal error handling
            }
          }

          // Tratar ALREADY_CONFIRMED como éxito aunque venga con success: false
          if (errorType === "ALREADY_CONFIRMED") {
            console.log(`[WHATSAPP] ✅ ALREADY_CONFIRMED detectado - tratando como éxito`)

            if (config.cliente_id) {
              const templateSentAt = await getTemplateSentTime(config.cliente_id, userPhoneNumber)
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

        const resetResult = await resetThreadForUser(userPhoneNumber, config.id)
        console.log(`[WHATSAPP] ✅ Thread reseteado exitosamente`)
        console.log(`[WHATSAPP] - Nuevo thread ID: ${resetResult.threadId}`)
        console.log(`[WHATSAPP] - isNewThread: ${resetResult.isNewThread}`)

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
          message: error.message,
          stack: error.stack,
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
    console.error("[WHATSAPP] Error al procesar el mensaje:", error)
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
) {
  console.log(
    `[WHATSAPP] Procesando mensaje individual para usuario ${userPhoneNumber}: "${userMessage}" (tipo: ${messageType})${audioId ? ` [audioId: ${audioId}]` : ""}`,
  )

  try {
    // Handle audio messages - transcribe using Whisper
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
      console.log(`[WHATSAPP] 🔇 Tipo de mensaje ${messageType} ignorado sin respuesta`)
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
      console.error("[WHATSAPP] Error al obtener thread ID:", error)

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
      console.error("[WHATSAPP] Error al obtener respuesta del asistente:", error)

      // Actualizar estadísticas - error
      await updateWhatsAppStats(config.id, { errors: 1 })

      // Si el error es 404 (thread no encontrado), intentar crear uno nuevo
      if (error.status === 404 && error.error?.type === "invalid_request_error") {
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
            console.error(`[WHATSAPP] ❌ Error guardando mensaje de error:`, saveError)
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

    console.log(`[WHATSAPP] Procesamiento individual completado para usuario ${userPhoneNumber}`)
  } catch (error) {
    console.error(`[WHATSAPP] Error al procesar mensaje individual para usuario ${userPhoneNumber}:`, error)

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
