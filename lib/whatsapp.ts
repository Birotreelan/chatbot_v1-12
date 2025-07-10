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

// Función principal para manejar mensajes de WhatsApp
export async function handleMessage(value: WhatsAppValue) {
  console.log(`[WA] 📨 Mensaje recibido`)

  try {
    // Verificar si hay mensajes
    if (!value.messages || value.messages.length === 0) {
      console.warn(`[WA] ⚠️ Sin mensajes`)
      return
    }

    // Extraer información del mensaje
    const message = value.messages[0]
    const userPhoneNumber = message.from
    let userMessage = extractMessageContent(message)

    console.log(`[WA] 👤 ${userPhoneNumber}: "${userMessage}" (${message.type})`)

    // Obtener la configuración de WhatsApp
    const config = await getWhatsAppConfigByPhoneId(value.metadata.phone_number_id)

    if (!config) {
      console.error(`[WA] ❌ Config no encontrada: ${value.metadata.phone_number_id}`)
      return
    }

    console.log(`[WA] ⚙️ Config: ${config.displayName}`)

    // Actualizar estadísticas - mensaje recibido
    await updateWhatsAppStats(config.id, { messagesReceived: 1 })

    // Guardar el número de teléfono del usuario en la configuración
    if (config.lastUserPhoneNumber !== userPhoneNumber) {
      await updateWhatsAppConfig(config.id, { lastUserPhoneNumber: userPhoneNumber })
    }

    // Detectar si es una respuesta de botón y enviarla al proxy
    if (message.type === "button" && message.button) {
      console.log(`[WA] 🔘 Botón: ${message.button.text}`)

      let proxyResponse = null
      try {
        const proxyPayload = {
          action: "template_response",
          Cliente_Id: config.cliente_id,
          Phone_Number_Id: value.metadata.phone_number_id,
          ...value,
        }

        console.log(`[WA] 📤 Enviando al proxy`)
        const response = await fetch(`${config.proxy}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(proxyPayload),
        })

        if (response.ok) {
          const responseText = await response.text()
          console.log(`[WA] 📥 Proxy OK`)
          try {
            proxyResponse = JSON.parse(responseText)
          } catch (parseError) {
            proxyResponse = { success: false, error: "PARSE_ERROR", raw: responseText }
          }
        } else {
          const errorText = await response.text()
          console.error(`[WA] ❌ Proxy error: ${response.status}`)
          proxyResponse = { success: false, error: "PROXY_ERROR", status: response.status, message: errorText }
        }
      } catch (error) {
        console.error(`[WA] ❌ Error proxy:`, error)
        proxyResponse = { success: false, error: "NETWORK_ERROR", message: error.message }
      }

      // Modificar el mensaje para incluir la respuesta del proxy
      if (proxyResponse) {
        const originalMessage = userMessage
        userMessage = `${originalMessage}\n\n[RESPUESTA_PROXY]\n${JSON.stringify(proxyResponse)}\n[/RESPUESTA_PROXY]`
      }
    }

    // Comandos especiales
    if (userMessage.toLowerCase() === "reset" || userMessage.toLowerCase() === "tree reset") {
      try {
        console.log(`[WA] 🔄 Reset para ${userPhoneNumber}`)

        const resetResult = await resetThreadForUser(userPhoneNumber, config.id)
        console.log(`[WA] ✅ Thread reseteado: ${resetResult.threadId.slice(-8)}`)

        await sendWhatsAppMessage(
          value.metadata.phone_number_id,
          config.accessToken,
          userPhoneNumber,
          "Conversación reiniciada. ¿En qué puedo ayudarte?",
        )

        await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
        return
      } catch (error) {
        console.error(`[WA] ❌ Error reset:`, error)
        await sendWhatsAppMessage(
          value.metadata.phone_number_id,
          config.accessToken,
          userPhoneNumber,
          "No se pudo reiniciar la conversación. Por favor, intenta de nuevo.",
        )
        await updateWhatsAppStats(config.id, { errors: 1 })
        return
      }
    }

    // Encolar el mensaje para procesamiento secuencial por usuario
    console.log(`[WA] 📋 Encolando mensaje`)
    await enqueueUserMessage(userPhoneNumber, {
      userMessage,
      messageType: message.type,
      phoneNumberId: value.metadata.phone_number_id,
      config,
    })

    console.log(`[WA] ✅ Mensaje encolado`)
  } catch (error) {
    console.error(`[WA] ❌ Error:`, error)
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
  console.log(`[WA] 🔄 Procesando: ${userPhoneNumber}`)

  try {
    // Obtener o crear un thread para este usuario
    let threadResult
    try {
      threadResult = await getThreadForUser(userPhoneNumber, config.id)
      console.log(`[WA] 🧵 Thread: ${threadResult.threadId.slice(-8)} (nuevo: ${threadResult.isNewThread})`)
    } catch (error) {
      console.error(`[WA] ❌ Error thread:`, error)
      await sendWhatsAppMessage(
        phoneNumberId,
        config.accessToken,
        userPhoneNumber,
        "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta de nuevo más tarde.",
      )
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

    // Obtener respuesta del asistente
    try {
      await getAssistantResponse(threadResult.threadId, messageToSend, phoneNumberId, config.whatsappAssistantId)
      await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
    } catch (error) {
      console.error(`[WA] ❌ Error OpenAI:`, error)
      await updateWhatsAppStats(config.id, { errors: 1 })

      // Si el error es 404 (thread no encontrado), intentar crear uno nuevo
      if (error.status === 404 && error.error?.type === "invalid_request_error") {
        try {
          console.log(`[WA] 🔄 Creando nuevo thread`)
          const openai = new (await import("openai")).default({
            apiKey: process.env.OPENAI_API_KEY,
          })

          const newThread = await openai.beta.threads.create()
          console.log(`[WA] ✅ Nuevo thread: ${newThread.id.slice(-8)}`)

          // Actualizar en la base de datos
          const key = `thread:${userPhoneNumber}:${config.id}`
          const redisClient = getRedisClient()

          const threadInfo = {
            threadId: newThread.id,
            phoneNumber: userPhoneNumber,
            whatsappConfigId: config.id,
            lastMessageAt: new Date().toISOString(),
            messageCount: 1,
            isResetThread: true,
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

          await getAssistantResponse(newThread.id, messageToSend, phoneNumberId, config.whatsappAssistantId)
          await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
        } catch (retryError) {
          console.error(`[WA] ❌ Error retry:`, retryError)
          await sendWhatsAppMessage(
            phoneNumberId,
            config.accessToken,
            userPhoneNumber,
            "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta de nuevo más tarde.",
          )
          await updateWhatsAppStats(config.id, { errors: 1 })
        }
      } else {
        await sendWhatsAppMessage(
          phoneNumberId,
          config.accessToken,
          userPhoneNumber,
          "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta de nuevo más tarde.",
        )
      }
    }

    console.log(`[WA] ✅ Procesamiento completado`)
  } catch (error) {
    console.error(`[WA] ❌ Error procesamiento:`, error)
    try {
      await sendWhatsAppMessage(
        phoneNumberId,
        config.accessToken,
        userPhoneNumber,
        "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta de nuevo más tarde.",
      )
    } catch (sendError) {
      console.error(`[WA] ❌ Error envío:`, sendError)
    }
  }
}
