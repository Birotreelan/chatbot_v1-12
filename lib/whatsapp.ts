import { getWhatsAppConfigByPhoneId, updateWhatsAppStats, getThreadForUser } from "./db"
import { processWhatsAppMessage } from "./whatsapp-processor"
import { logError, incrementMetric } from "./monitoring"
import { getOrCreateConversation, logMessage } from "./conversation-logger"

export async function processIndividualMessage(
  userMessage: string,
  phoneNumberId: string,
  config: any,
  userPhoneNumber: string,
  messageType?: string,
): Promise<void> {
  console.log(`[WHATSAPP] 🔄 Procesando mensaje individual de ${userPhoneNumber}`)

  try {
    // Get or create conversation
    const threadInfo = await getThreadForUser(userPhoneNumber, config.id)
    const conversation = await getOrCreateConversation(
      userPhoneNumber,
      config.id,
      threadInfo.threadId,
      "Usuario", // Default name since we don't have contact info here
      config.displayName,
    )

    await logMessage(conversation.id, "user", userMessage)

    // Update stats
    await updateWhatsAppStats(config.id, { messagesReceived: 1 })
    await incrementMetric("messages_received")

    // Process with AI
    const startTime = Date.now()
    const response = await processWhatsAppMessage({
      phoneNumber: userPhoneNumber,
      message: userMessage,
      config,
    })
    const processingTime = Date.now() - startTime

    // Send response
    if (response) {
      const sent = await sendWhatsAppMessage(userPhoneNumber, response, config)
      if (sent) {
        await incrementMetric("messages_sent")
        await logMessage(conversation.id, "assistant", response, {
          assistantId: config.whatsappAssistantId,
          processingTime,
        })
      } else {
        await incrementMetric("message_send_errors")
      }
    }
  } catch (error) {
    console.error(`[WHATSAPP] ❌ Error procesando mensaje individual:`, error)
    await logError("whatsapp_individual_message_processing", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

// Función principal para manejar mensajes de WhatsApp
export async function handleMessage(messageData: any): Promise<void> {
  console.log("[WHATSAPP] ========== PROCESANDO WEBHOOK ==========")
  console.log("[WHATSAPP] Datos recibidos:", JSON.stringify(messageData, null, 2))

  try {
    // Verificar que tenemos los datos necesarios
    if (!messageData.messages || !Array.isArray(messageData.messages) || messageData.messages.length === 0) {
      console.log("[WHATSAPP] ⚠️ No hay mensajes válidos en los datos")
      return
    }

    if (!messageData.metadata || !messageData.metadata.phone_number_id) {
      console.log("[WHATSAPP] ⚠️ No hay metadata válida en los datos")
      return
    }

    const phoneNumberId = messageData.metadata.phone_number_id
    const message = messageData.messages[0]
    const userPhoneNumber = message.from

    console.log(`[WHATSAPP] 📱 Procesando mensaje de ${userPhoneNumber} para phoneNumberId=${phoneNumberId}`)

    // Obtener la configuración de WhatsApp
    const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
    if (!config) {
      console.error(`[WHATSAPP] ❌ Configuración no encontrada para phoneNumberId=${phoneNumberId}`)
      await logError("whatsapp_config_not_found", new Error(`Config not found for phoneNumberId: ${phoneNumberId}`))
      return
    }

    console.log(`[WHATSAPP] ✅ Configuración encontrada: ${config.displayName} (${config.id})`)

    // Obtener información del contacto
    let userName = "Usuario"
    if (messageData.contacts && messageData.contacts.length > 0) {
      const contact = messageData.contacts.find((c: any) => c.wa_id === userPhoneNumber)
      if (contact && contact.profile && contact.profile.name) {
        userName = contact.profile.name
      }
    }

    console.log(`[WHATSAPP] 👤 Usuario: ${userName} (${userPhoneNumber})`)

    // Verificar que es un mensaje de texto
    if (message.type !== "text" || !message.text || !message.text.body) {
      console.log(`[WHATSAPP] ⚠️ Tipo de mensaje no soportado: ${message.type}`)

      // Enviar mensaje de error para tipos no soportados
      const errorMessage = "Lo siento, solo puedo procesar mensajes de texto por el momento."
      await sendWhatsAppMessage(userPhoneNumber, errorMessage, config)
      return
    }

    const messageText = message.text.body
    console.log(`[WHATSAPP] 💬 Mensaje: "${messageText}"`)

    const threadInfo = await getThreadForUser(userPhoneNumber, config.id)

    const conversation = await getOrCreateConversation(
      userPhoneNumber,
      config.id,
      threadInfo.threadId,
      userName,
      config.displayName,
    )

    await logMessage(conversation.id, "user", messageText, {
      whatsappMessageId: message.id,
    })

    // Actualizar estadísticas de mensajes recibidos
    await updateWhatsAppStats(config.id, { messagesReceived: 1 })

    // Incrementar métrica de mensajes recibidos
    await incrementMetric("messages_received")

    // Procesar el mensaje con IA
    console.log(`[WHATSAPP] 🤖 Enviando a procesamiento de IA...`)
    const startTime = Date.now()
    const response = await processWhatsAppMessage({
      phoneNumber: userPhoneNumber,
      message: messageText,
      config,
    })
    const processingTime = Date.now() - startTime

    // Enviar la respuesta
    if (response) {
      const sent = await sendWhatsAppMessage(userPhoneNumber, response, config)
      if (sent) {
        console.log(`[WHATSAPP] ✅ Respuesta enviada exitosamente`)
        await incrementMetric("messages_sent")

        await logMessage(conversation.id, "assistant", response, {
          assistantId: config.whatsappAssistantId,
          processingTime,
        })
      } else {
        console.error(`[WHATSAPP] ❌ Error enviando respuesta`)
        await incrementMetric("message_send_errors")
      }
    }

    console.log(`[WHATSAPP] ✅ Mensaje procesado exitosamente`)
  } catch (error) {
    console.error("[WHATSAPP] ❌ Error procesando mensaje:", error)
    await logError("whatsapp_message_processing", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

// Función para enviar mensajes de WhatsApp
export async function sendWhatsAppMessage(phoneNumber: string, message: string, config: any): Promise<boolean> {
  try {
    console.log(`[WHATSAPP] 📤 Enviando mensaje a ${phoneNumber}`)

    const url = `https://graph.facebook.com/v18.0/${config.phoneNumberId}/messages`

    const payload = {
      messaging_product: "whatsapp",
      to: phoneNumber,
      type: "text",
      text: {
        body: message,
      },
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[WHATSAPP] ❌ Error enviando mensaje: ${response.status} - ${errorText}`)
      return false
    }

    const result = await response.json()
    console.log(`[WHATSAPP] ✅ Mensaje enviado exitosamente:`, result)

    // Incrementar métrica de mensajes enviados
    await incrementMetric("messages_sent")

    return true
  } catch (error) {
    console.error(`[WHATSAPP] ❌ Error enviando mensaje:`, error)
    await logError("whatsapp_send_message", error instanceof Error ? error : new Error(String(error)))
    return false
  }
}
