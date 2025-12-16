import type { WhatsAppValue } from "@/lib/types"
import { getWhatsAppConfigByPhoneId, updateWhatsAppStats, getThreadForUser, resetThreadForUser } from "@/lib/db"
import { sendWhatsAppMessage } from "@/lib/whatsapp-api"
import { getAssistantResponse } from "@/lib/openai-tools"
import { getArgentinaDateTime } from "@/lib/utils/date-utils"
import { normalizePhoneNumber } from "@/lib/utils"
import { getRedisClient } from "./redis"
import { enqueueUserMessage } from "./user-queue"
import { saveConversationMessage, isConversationPaused } from "./conversations"
import { nanoid } from "nanoid"
import { TIMEOUTS, fetchWithRetry } from "./config/timeouts"
import { trackAppointmentEvent, getTemplateSentTime } from "./appointment-stats"

// Función para extraer el contenido del mensaje según su tipo
function extractMessageContent(message: any): string {
  switch (message.type) {
    case "text":
      return message.text?.body || ""
    case "button":
      return message.button?.text || message.button?.payload || ""
    case "interactive":
      if (message.interactive?.type === "button_reply") {
        return message.interactive.button_reply?.title || message.interactive.button_reply?.id || ""
      } else if (message.interactive?.type === "list_reply") {
        return message.interactive.list_reply?.title || message.interactive.list_reply?.id || ""
      }
      return ""
    default:
      return ""
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
    let userMessage = extractMessageContent(message)
    const originalMessage = userMessage

    console.log(`[WHATSAPP] Procesando mensaje de ${userPhoneNumber}: "${userMessage}" (tipo: ${message.type})`)

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
) {
  console.log(
    `[WHATSAPP] Procesando mensaje individual para usuario ${userPhoneNumber}: "${userMessage}" (tipo: ${messageType})`,
  )

  try {
    const unsupportedMessageTypes: Record<string, string> = {
      sticker:
        "Lo siento, soy un asistente virtual y no tengo la capacidad de entender stickers o imagenes. Responda escribiendo texto, por favor.",
      reaction:
        "Lo siento, soy un asistente virtual y no tengo la capacidad de procesar reacciones o iconos en mensajes. Responda escribiendo texto, por favor.",
      audio:
        "Lo siento, soy un asistente virtual y no tengo la capacidad de entender mensajes de audio. Responda escribiendo texto, por favor.",
    }

    if (messageType && unsupportedMessageTypes[messageType]) {
      const errorMessage = unsupportedMessageTypes[messageType]

      console.log(`[WHATSAPP] Tipo de mensaje no soportado detectado: ${messageType}`)
      console.log(`[WHATSAPP] Enviando respuesta automática sin OpenAI`)

      // Save the automatic response to conversation
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
        console.log(`[WHATSAPP] 💾 Respuesta automática guardada en conversación`)
      } catch (saveError) {
        console.error(`[WHATSAPP] ❌ Error guardando respuesta automática:`, saveError)
      }

      // Send direct message to user
      try {
        await sendWhatsAppMessage(phoneNumberId, config.accessToken, userPhoneNumber, errorMessage)

        // Update stats - message processed
        await updateWhatsAppStats(config.id, { messagesProcessed: 1 })

        console.log(`[WHATSAPP] ✅ Respuesta automática enviada para tipo: ${messageType}`)
        return // Exit early, don't process with OpenAI
      } catch (sendError) {
        console.error(`[WHATSAPP] ❌ Error al enviar respuesta automática:`, sendError)
        // Update stats - error
        await updateWhatsAppStats(config.id, { errors: 1 })
        return
      }
    }
    // </CHANGE>

    // Obtener o crear un thread para este usuario
    let threadResult
    try {
      console.log(`[WHATSAPP] Obteniendo thread para usuario ${userPhoneNumber} y config ${config.id}`)
      threadResult = await getThreadForUser(userPhoneNumber, config.id)
      console.log(`[WHATSAPP] Thread obtenido: ${threadResult.threadId}, isNewThread: ${threadResult.isNewThread}`)
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

    // Preparar mensaje con parámetros iniciales
    const fechaHora = getArgentinaDateTime()
    let messageToSend = `[SISTEMA]
Nombre: ${config.displayName}
FechaHora: ${fechaHora}
PrimerMensaje: ${threadResult.isNewThread}
TipoMensaje: ${messageType}
PacienteCelular: ${userPhoneNumber}${config.escalationPhoneNumber ? `\nNumeroDerivacion: ${config.escalationPhoneNumber}` : ""}
[/SISTEMA]

${userMessage}`

    // Si es un thread reseteado, indicarlo
    if (threadResult.isResetThread) {
      messageToSend = `[SISTEMA]
Nombre: ${config.displayName}
FechaHora: ${fechaHora}
PrimerMensaje: true
ThreadReseteado: true
TipoMensaje: ${messageType}
PacienteCelular: ${userPhoneNumber}${config.escalationPhoneNumber ? `\nNumeroDerivacion: ${config.escalationPhoneNumber}` : ""}
[/SISTEMA]

${userMessage}`
    }

    console.log(`[WHATSAPP] Mensaje preparado para OpenAI:`, messageToSend)

    // Obtener respuesta del asistente
    try {
      console.log(`[v0] 📞 Antes de llamar getAssistantResponse:`, {
        userPhoneNumber,
        threadId: threadResult.threadId,
        phoneNumberId,
        assistantId: config.whatsappAssistantId,
      })
      console.log(`[WHATSAPP] Llamando a getAssistantResponse...`)
      // Usar el ID de asistente específico para esta configuración y pasar el phoneNumberId
      await getAssistantResponse(
        threadResult.threadId,
        messageToSend,
        phoneNumberId,
        config.whatsappAssistantId,
        userPhoneNumber,
      )

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

          // Preparar mensaje con parámetros iniciales
          const fechaHora = getArgentinaDateTime()
          messageToSend = `[SISTEMA]
Nombre: ${config.displayName}
FechaHora: ${fechaHora}
PrimerMensaje: true
TipoMensaje: ${messageType}
PacienteCelular: ${userPhoneNumber}${config.escalationPhoneNumber ? `\nNumeroDerivacion: ${config.escalationPhoneNumber}` : ""}
[/SISTEMA]

${userMessage}`

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
          await sendWhatsAppMessage(phoneNumberId, config.accessToken, userPhoneNumber, errorMessage)

          // Actualizar estadísticas - error
          await updateWhatsAppStats(config.id, { errors: 1 })
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
