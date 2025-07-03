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

// Simplificar logs de WhatsApp - solo conversaciones importantes
export async function handleMessage(value: WhatsAppValue) {
  try {
    if (!value.messages || value.messages.length === 0) {
      return
    }

    const message = value.messages[0]
    const userPhoneNumber = message.from
    let userMessage = extractMessageContent(message)

    console.log(`[WHATSAPP] 📱 ${userPhoneNumber.slice(-4)}: "${userMessage}" (${message.type})`)

    const config = await getWhatsAppConfigByPhoneId(value.metadata.phone_number_id)

    if (!config) {
      console.error(`[WHATSAPP] ❌ Config no encontrada: ${value.metadata.phone_number_id}`)
      return
    }

    console.log(`[WHATSAPP] 🏥 Cliente: ${config.displayName}`)

    await updateWhatsAppStats(config.id, { messagesReceived: 1 })

    if (config.lastUserPhoneNumber !== userPhoneNumber) {
      await updateWhatsAppConfig(config.id, { lastUserPhoneNumber: userPhoneNumber })
    }

    // Detectar respuesta de botón
    if (message.type === "button" && message.button) {
      console.log(`[WHATSAPP] 🔘 Botón: ${message.button.text} (${message.button.payload})`)

      let proxyResponse = null
      try {
        const proxyPayload = {
          action: "template_response",
          Cliente_Id: config.cliente_id,
          Phone_Number_Id: value.metadata.phone_number_id,
          ...value,
        }

        console.log(`[WHATSAPP] 📤 Enviando al proxy: ${config.proxy}`)

        const response = await fetch(`${config.proxy}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(proxyPayload),
        })

        if (response.ok) {
          const responseText = await response.text()
          console.log(`[WHATSAPP] 📥 Respuesta proxy: ${responseText}`)

          try {
            proxyResponse = JSON.parse(responseText)
          } catch (parseError) {
            proxyResponse = { success: false, error: "PARSE_ERROR", raw: responseText }
          }
        } else {
          const errorText = await response.text()
          console.error(`[WHATSAPP] ❌ Error proxy: ${response.status} - ${errorText}`)
          proxyResponse = { success: false, error: "PROXY_ERROR", status: response.status, message: errorText }
        }
      } catch (error) {
        console.error(`[WHATSAPP] ❌ Error red proxy:`, error.message)
        proxyResponse = { success: false, error: "NETWORK_ERROR", message: error.message }
      }

      if (proxyResponse) {
        const originalMessage = userMessage
        userMessage = `${originalMessage}\n\n[RESPUESTA_PROXY]\n${JSON.stringify(proxyResponse)}\n[/RESPUESTA_PROXY]`
      }
    }

    // Comandos especiales
    if (userMessage.toLowerCase() === "reset" || userMessage.toLowerCase() === "tree reset") {
      try {
        console.log(`[WHATSAPP] 🔄 Reset para ${userPhoneNumber.slice(-4)}`)

        const resetResult = await resetThreadForUser(userPhoneNumber, config.id)
        console.log(`[WHATSAPP] ✅ Thread reseteado: ${resetResult.threadId}`)

        await sendWhatsAppMessage(
          value.metadata.phone_number_id,
          config.accessToken,
          userPhoneNumber,
          "Conversación reiniciada. ¿En qué puedo ayudarte?",
        )

        await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
        return
      } catch (error) {
        console.error("[WHATSAPP] ❌ Error reset:", error.message)

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

    // Encolar mensaje
    console.log(`[WHATSAPP] 📋 Encolando mensaje para ${userPhoneNumber.slice(-4)}`)
    await enqueueUserMessage(userPhoneNumber, {
      userMessage,
      messageType: message.type,
      phoneNumberId: value.metadata.phone_number_id,
      config,
    })

    console.log(`[WHATSAPP] ✅ Mensaje encolado`)
  } catch (error) {
    console.error("[WHATSAPP] ❌ Error:", error.message)
  }
}

// Simplificar processIndividualMessage
export async function processIndividualMessage(
  userMessage: string,
  phoneNumberId: string,
  config: any,
  userPhoneNumber: string,
  messageType = "text",
) {
  console.log(`[WHATSAPP] 🔄 Procesando: ${userPhoneNumber.slice(-4)} - "${userMessage}"`)

  try {
    let threadResult
    try {
      threadResult = await getThreadForUser(userPhoneNumber, config.id)
      console.log(`[WHATSAPP] 🧵 Thread: ${threadResult.threadId} (nuevo: ${threadResult.isNewThread})`)
    } catch (error) {
      console.error("[WHATSAPP] ❌ Error thread:", error.message)
      await sendWhatsAppMessage(
        phoneNumberId,
        config.accessToken,
        userPhoneNumber,
        "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta de nuevo más tarde.",
      )
      await updateWhatsAppStats(config.id, { errors: 1 })
      return
    }

    const fechaHora = getArgentinaDateTime()
    let messageToSend = `[SISTEMA]
Nombre: ${config.displayName}
FechaHora: ${fechaHora}
PrimerMensaje: ${threadResult.isNewThread}
TipoMensaje: ${messageType}
PacienteCelular: ${userPhoneNumber}
[/SISTEMA]

${userMessage}`

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

    try {
      await getAssistantResponse(threadResult.threadId, messageToSend, phoneNumberId, config.whatsappAssistantId)
      await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
      console.log(`[WHATSAPP] ✅ Procesado: ${userPhoneNumber.slice(-4)}`)
    } catch (error) {
      console.error("[WHATSAPP] ❌ Error assistant:", error.message)
      await updateWhatsAppStats(config.id, { errors: 1 })

      if (error.status === 404 && error.error?.type === "invalid_request_error") {
        try {
          console.log("[WHATSAPP] 🔄 Creando nuevo thread...")
          const openai = new (await import("openai")).default({
            apiKey: process.env.OPENAI_API_KEY,
          })

          const newThread = await openai.beta.threads.create()
          console.log(`[WHATSAPP] ✅ Nuevo thread: ${newThread.id}`)

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
          console.error("[WHATSAPP] ❌ Error retry:", retryError.message)

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
  } catch (error) {
    console.error(`[WHATSAPP] ❌ Error procesando ${userPhoneNumber.slice(-4)}:`, error.message)
    try {
      await sendWhatsAppMessage(
        phoneNumberId,
        config.accessToken,
        userPhoneNumber,
        "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta de nuevo más tarde.",
      )
    } catch (sendError) {
      console.error("[WHATSAPP] ❌ Error enviando mensaje error:", sendError.message)
    }
  }
}
