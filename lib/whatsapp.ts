import { processWhatsAppMessage } from "./whatsapp-processor"
import { getWhatsAppConfigByPhoneId, updateWhatsAppStats, saveConversationMessage } from "./db"
import { logError, incrementMetric } from "./monitoring"
import { sendWhatsAppMessage } from "./whatsapp-api"

// Función principal para manejar mensajes de WhatsApp
export async function handleMessage(body: any): Promise<void> {
  try {
    console.log("[WHATSAPP] ========== PROCESANDO WEBHOOK ==========")
    console.log("[WHATSAPP] Datos recibidos:", JSON.stringify(body, null, 2))

    // La estructura correcta de WhatsApp viene directamente en el body
    if (!body.messages || !Array.isArray(body.messages)) {
      console.log("[WHATSAPP] ⚠️ No hay mensajes en el webhook")
      return
    }

    // Obtener información del número de teléfono desde metadata
    const phoneNumberId = body.metadata?.phone_number_id
    if (!phoneNumberId) {
      console.log("[WHATSAPP] ⚠️ Sin phone_number_id en metadata")
      return
    }

    console.log(`[WHATSAPP] 📱 Procesando para phone_number_id: ${phoneNumberId}`)

    // Obtener configuración
    const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
    if (!config) {
      console.log(`[WHATSAPP] ❌ No se encontró configuración para phoneNumberId: ${phoneNumberId}`)
      return
    }

    console.log(`[WHATSAPP] ⚙️ Configuración encontrada: ${config.displayName}`)

    // Procesar cada mensaje
    for (const message of body.messages) {
      await processIncomingMessage(message, body, config)
    }

    console.log("[WHATSAPP] ✅ Webhook procesado exitosamente")
  } catch (error) {
    console.error("[WHATSAPP] ❌ Error procesando webhook:", error)
    await logError("whatsapp_webhook", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

// Función para procesar mensajes entrantes
async function processIncomingMessage(message: any, body: any, config: any): Promise<void> {
  try {
    const phoneNumber = message.from
    const messageText = message.text?.body || ""
    const messageType = message.type || "unknown"
    const messageId = message.id

    console.log(`[WHATSAPP] 📨 Mensaje entrante de ${phoneNumber}: "${messageText}"`)

    // Actualizar estadísticas
    await updateWhatsAppStats(config.id, { messagesReceived: 1 })

    // Obtener información del contacto
    let userName = phoneNumber
    if (body.contacts && Array.isArray(body.contacts)) {
      const contact = body.contacts.find((c: any) => c.wa_id === phoneNumber)
      if (contact?.profile?.name) {
        userName = contact.profile.name
      }
    }

    console.log(`[WHATSAPP] 👤 Usuario identificado: ${userName}`)

    // Solo procesar mensajes de texto
    if (messageType !== "text") {
      console.log(`[WHATSAPP] ⚠️ Tipo de mensaje no soportado: ${messageType}`)
      await sendWhatsAppMessage(
        config.phoneNumberId,
        config.accessToken,
        phoneNumber,
        "Lo siento, solo puedo procesar mensajes de texto por el momento.",
      )
      return
    }

    // Guardar mensaje entrante ANTES de procesarlo
    let savedMessageId: string | null = null
    try {
      savedMessageId = await saveConversationMessage(
        phoneNumber,
        config.id,
        config.cliente_id || "",
        messageText,
        "incoming",
        undefined, // threadId se asignará después
        userName,
      )
      console.log(`[WHATSAPP] 💾 Mensaje entrante guardado con ID: ${savedMessageId}`)
    } catch (error) {
      console.error("[WHATSAPP] ❌ Error guardando mensaje entrante:", error)
    }

    // Procesar el mensaje con el sistema de IA
    console.log(`[WHATSAPP] 🤖 Enviando a procesamiento de IA`)

    try {
      const response = await processWhatsAppMessage({
        message: messageText,
        phoneNumber,
        config,
      })

      console.log(`[WHATSAPP] ✅ Respuesta generada: ${response.length} caracteres`)

      // Enviar respuesta
      await sendWhatsAppMessage(config.phoneNumberId, config.accessToken, phoneNumber, response)
      console.log(`[WHATSAPP] 📤 Respuesta enviada a WhatsApp`)

      // Guardar respuesta del bot
      try {
        const botMessageId = await saveConversationMessage(
          phoneNumber,
          config.id,
          config.cliente_id || "",
          response,
          "outgoing",
          undefined, // threadId se puede obtener del procesamiento
          userName,
        )
        console.log(`[WHATSAPP] 💾 Respuesta del bot guardada con ID: ${botMessageId}`)
      } catch (error) {
        console.error("[WHATSAPP] ❌ Error guardando respuesta del bot:", error)
      }

      // Incrementar métricas
      await incrementMetric("messages_sent")
      await updateWhatsAppStats(config.id, { messagesProcessed: 1 })

      console.log(`[WHATSAPP] ✅ Mensaje procesado completamente`)
    } catch (aiError) {
      console.error(`[WHATSAPP] ❌ Error en procesamiento de IA:`, aiError)

      // Enviar mensaje de error al usuario
      const errorMessage = "Lo siento, ha ocurrido un error procesando tu mensaje. Por favor, intenta nuevamente."
      try {
        await sendWhatsAppMessage(config.phoneNumberId, config.accessToken, phoneNumber, errorMessage)

        // Guardar mensaje de error
        await saveConversationMessage(
          phoneNumber,
          config.id,
          config.cliente_id || "",
          errorMessage,
          "outgoing",
          undefined,
          userName,
        )
      } catch (sendError) {
        console.error("[WHATSAPP] ❌ Error enviando mensaje de error:", sendError)
      }

      // Actualizar estadísticas de error
      await updateWhatsAppStats(config.id, { errors: 1 })
    }
  } catch (error) {
    console.error(`[WHATSAPP] ❌ Error procesando mensaje:`, error)
    await logError("process_incoming_message", error instanceof Error ? error : new Error(String(error)))

    // Actualizar estadísticas de error
    await updateWhatsAppStats(config.id, { errors: 1 })

    // Enviar mensaje de error al usuario como último recurso
    try {
      await sendWhatsAppMessage(
        config.phoneNumberId,
        config.accessToken,
        message.from,
        "Lo siento, ha ocurrido un error. Por favor, intenta nuevamente.",
      )
    } catch (sendError) {
      console.error("[WHATSAPP] ❌ Error enviando mensaje de error final:", sendError)
    }
  }
}
