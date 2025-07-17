import type { WhatsAppValue } from "@/lib/types"
import {
  getWhatsAppConfigByPhoneId,
  updateWhatsAppStats,
  getThreadForUser,
  resetThreadForUser,
  updateWhatsAppConfig,
} from "@/lib/db"
import { sendWhatsAppMessage } from "@/lib/whatsapp-api"
import { getAssistantResponse } from "@/lib/openai-tools"
import { getArgentinaDateTime } from "@/lib/utils/date-utils"
import { getRedisClient } from "./redis"
import { enqueueUserMessage } from "./user-queue"

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
    const userPhoneNumber = message.from
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

    // Actualizar estadísticas - mensaje recibido
    await updateWhatsAppStats(config.id, { messagesReceived: 1 })

    // Guardar el número de teléfono del usuario en la configuración
    if (config.lastUserPhoneNumber !== userPhoneNumber) {
      console.log(`[WHATSAPP] Actualizando número de teléfono del usuario: ${userPhoneNumber}`)
      await updateWhatsAppConfig(config.id, { lastUserPhoneNumber: userPhoneNumber })
    }

    // Detectar si es una respuesta de botón y enviarla al proxy
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

        // Enviar la respuesta completa al proxy
        const response = await fetch(`${config.proxy}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(proxyPayload),
        })

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
            // Usar la información específica del proxy para crear el mensaje
            switch (proxyResponse.action_type) {
              case "confirmacion_turno":
                userMessage = `El paciente confirmó su turno presionando "${originalMessage}".

[CONFIRMACION_TURNO_EXITOSA]
Accion: Confirmación de turno
Estado: ${proxyResponse.status}
Mensaje: ${proxyResponse.message}
Instrucciones: ${proxyResponse.next_steps}
Timestamp: ${proxyResponse.timestamp}
[/CONFIRMACION_TURNO_EXITOSA]

Responde confirmando que el turno fue confirmado exitosamente y proporciona los detalles relevantes.`
                break

              case "cancelacion_turno":
                userMessage = `El paciente canceló su turno presionando "${originalMessage}".

[CANCELACION_TURNO_EXITOSA]
Accion: Cancelación de turno
Estado: ${proxyResponse.status}
Mensaje: ${proxyResponse.message}
Instrucciones: ${proxyResponse.next_steps}
Timestamp: ${proxyResponse.timestamp}
[/CANCELACION_TURNO_EXITOSA]

Responde confirmando que el turno fue cancelado y ofrece ayuda para reagendar.`
                break

              case "reprogramacion_turno":
                userMessage = `El paciente solicitó reprogramar su turno presionando "${originalMessage}".

[REPROGRAMACION_TURNO_SOLICITADA]
Accion: Reprogramación de turno
Estado: ${proxyResponse.status}
Mensaje: ${proxyResponse.message}
Instrucciones: ${proxyResponse.next_steps}
Timestamp: ${proxyResponse.timestamp}
[/REPROGRAMACION_TURNO_SOLICITADA]

Responde confirmando que la solicitud fue recibida y explica los próximos pasos.`
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
            userMessage = `El paciente respondió "${originalMessage}" a una plantilla.

[RESPUESTA_BOTON_PROCESADA]
Accion: respuesta_generica
Estado: procesado
Mensaje: Respuesta "${originalMessage}" procesada exitosamente
Instrucciones: La respuesta del botón fue registrada correctamente
Timestamp: ${new Date().toISOString()}
[/RESPUESTA_BOTON_PROCESADA]

Responde confirmando que la respuesta fue recibida y procesada correctamente.`
          }
        } else {
          // Si hay error en el proxy
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

    // Comandos especiales
    if (userMessage.toLowerCase() === "reset" || userMessage.toLowerCase() === "tree reset") {
      try {
        console.log(`[WHATSAPP] Procesando comando de reset para el usuario ${userPhoneNumber}`)

        // Usar la función resetThreadForUser para reiniciar la conversación
        const resetResult = await resetThreadForUser(userPhoneNumber, config.id)
        console.log(`[WHATSAPP] Thread reseteado: ${resetResult.threadId}, isNewThread: ${resetResult.isNewThread}`)

        // Enviar mensaje de confirmación
        await sendWhatsAppMessage(
          value.metadata.phone_number_id,
          config.accessToken,
          userPhoneNumber,
          "Conversación reiniciada. ¿En qué puedo ayudarte?",
        )

        // Actualizar estadísticas - mensaje procesado
        await updateWhatsAppStats(config.id, { messagesProcessed: 1 })

        return // Importante: salir de la función después de procesar el reset
      } catch (error) {
        console.error("[WHATSAPP] Error al resetear conversación:", error)

        // Enviar mensaje de error
        await sendWhatsAppMessage(
          value.metadata.phone_number_id,
          config.accessToken,
          userPhoneNumber,
          "No se pudo reiniciar la conversación. Por favor, intenta de nuevo.",
        )

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
    // Obtener o crear un thread para este usuario
    let threadResult
    try {
      console.log(`[WHATSAPP] Obteniendo thread para usuario ${userPhoneNumber} y config ${config.id}`)
      threadResult = await getThreadForUser(userPhoneNumber, config.id)
      console.log(`[WHATSAPP] Thread obtenido: ${threadResult.threadId}, isNewThread: ${threadResult.isNewThread}`)
    } catch (error) {
      console.error("[WHATSAPP] Error al obtener thread ID:", error)
      await sendWhatsAppMessage(
        phoneNumberId,
        config.accessToken,
        userPhoneNumber,
        "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta de nuevo más tarde.",
      )
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
PacienteCelular: ${userPhoneNumber}
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
PacienteCelular: ${userPhoneNumber}
[/SISTEMA]

${userMessage}`
    }

    console.log(`[WHATSAPP] Mensaje preparado para OpenAI:`, messageToSend)

    // Obtener respuesta del asistente
    try {
      console.log(`[WHATSAPP] Llamando a getAssistantResponse...`)
      // Usar el ID de asistente específico para esta configuración y pasar el phoneNumberId
      await getAssistantResponse(threadResult.threadId, messageToSend, phoneNumberId, config.whatsappAssistantId)

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
PacienteCelular: ${userPhoneNumber}
[/SISTEMA]

${userMessage}`

          console.log(`[WHATSAPP] Reintentando con nuevo thread...`)
          await getAssistantResponse(newThread.id, messageToSend, phoneNumberId, config.whatsappAssistantId)

          // Actualizar estadísticas - mensaje procesado
          await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
        } catch (retryError) {
          console.error("[WHATSAPP] Error al reintentar con nuevo thread:", retryError)

          // Enviar mensaje de error al usuario
          await sendWhatsAppMessage(
            phoneNumberId,
            config.accessToken,
            userPhoneNumber,
            "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta de nuevo más tarde.",
          )

          // Actualizar estadísticas - error
          await updateWhatsAppStats(config.id, { errors: 1 })
        }
      } else {
        // Enviar mensaje de error al usuario
        await sendWhatsAppMessage(
          phoneNumberId,
          config.accessToken,
          userPhoneNumber,
          "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta de nuevo más tarde.",
        )
      }
    }

    console.log(`[WHATSAPP] Procesamiento individual completado para usuario ${userPhoneNumber}`)
  } catch (error) {
    console.error(`[WHATSAPP] Error al procesar mensaje individual para usuario ${userPhoneNumber}:`, error)
    // Enviar mensaje de error al usuario
    try {
      await sendWhatsAppMessage(
        phoneNumberId,
        config.accessToken,
        userPhoneNumber,
        "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta de nuevo más tarde.",
      )
    } catch (sendError) {
      console.error("[WHATSAPP] Error al enviar mensaje de error:", sendError)
    }
  }
}
