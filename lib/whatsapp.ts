import { processWhatsAppMessage } from "./whatsapp-processor"
import { getWhatsAppConfigByPhoneId, updateWhatsAppStats, saveConversationMessage } from "./db"
import { logError, incrementMetric } from "./monitoring"
import { sendWhatsAppMessage } from "./whatsapp-api"

// Función principal para manejar mensajes de WhatsApp
export async function handleMessage(body: any): Promise<void> {
  try {
    console.log("[WHATSAPP] ========== PROCESANDO WEBHOOK ==========")
    console.log("[WHATSAPP] Datos recibidos:", JSON.stringify(body, null, 2))

    // Validar estructura del webhook
    if (!body.entry || !Array.isArray(body.entry)) {
      console.log("[WHATSAPP] ⚠️ Webhook sin entries válidas")
      return
    }

    // Procesar cada entry
    for (const entry of body.entry) {
      if (!entry.changes || !Array.isArray(entry.changes)) {
        console.log("[WHATSAPP] ⚠️ Entry sin changes válidos")
        continue
      }

      // Procesar cada change
      for (const change of entry.changes) {
        if (change.field !== "messages") {
          console.log(`[WHATSAPP] ⚠️ Change field no es 'messages': ${change.field}`)
          continue
        }

        const value = change.value
        if (!value) {
          console.log("[WHATSAPP] ⚠️ Change sin value")
          continue
        }

        // Obtener información del número de teléfono
        const phoneNumberId = value.metadata?.phone_number_id
        if (!phoneNumberId) {
          console.log("[WHATSAPP] ⚠️ Sin phone_number_id en metadata")
          continue
        }

        console.log(`[WHATSAPP] 📱 Procesando para phone_number_id: ${phoneNumberId}`)

        // Obtener configuración
        const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
        if (!config) {
          console.log(`[WHATSAPP] ❌ No se encontró configuración para phoneNumberId: ${phoneNumberId}`)
          continue
        }

        console.log(`[WHATSAPP] ⚙️ Configuración encontrada: ${config.displayName}`)

        // Procesar mensajes entrantes
        if (value.messages && Array.isArray(value.messages)) {
          for (const message of value.messages) {
            await processIncomingMessage(message, value, config)
          }
        }

        // Procesar estados de mensajes (delivered, read, etc.)
        if (value.statuses && Array.isArray(value.statuses)) {
          console.log(`[WHATSAPP] 📊 Procesando ${value.statuses.length} estados de mensaje`)
          // Aquí podrías procesar los estados si es necesario
        }
      }
    }

    console.log("[WHATSAPP] ✅ Webhook procesado exitosamente")
  } catch (error) {
    console.error("[WHATSAPP] ❌ Error procesando webhook:", error)
    await logError("whatsapp_webhook", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

// Función para procesar mensajes entrantes
async function processIncomingMessage(message: any, value: any, config: any): Promise<void> {
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
    if (value.contacts && Array.isArray(value.contacts)) {
      const contact = value.contacts.find((c: any) => c.wa_id === phoneNumber)
      if (contact?.profile?.name) {
        userName = contact.profile.name
      }
    }

    // Guardar mensaje entrante
    try {
      await saveConversationMessage(
        phoneNumber,
        config.id,
        config.cliente_id || "",
        messageText,
        "incoming",
        undefined, // threadId se asignará después
        userName,
      )
      console.log(`[WHATSAPP] 💾 Mensaje entrante guardado`)
    } catch (error) {
      console.error("[WHATSAPP] ❌ Error guardando mensaje entrante:", error)
    }

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

    // Procesar el mensaje con el sistema de IA
    console.log(`[WHATSAPP] 🤖 Enviando a procesamiento de IA`)
    const response = await processWhatsAppMessage({
      message: messageText,
      phoneNumber,
      config,
    })

    console.log(`[WHATSAPP] ✅ Respuesta generada: ${response.length} caracteres`)

    // Enviar respuesta
    await sendWhatsAppMessage(config.phoneNumberId, config.accessToken, phoneNumber, response)

    // Guardar respuesta del bot
    try {
      await saveConversationMessage(
        phoneNumber,
        config.id,
        config.cliente_id || "",
        response,
        "outgoing",
        undefined, // threadId se puede obtener del procesamiento
        userName,
      )
      console.log(`[WHATSAPP] 💾 Respuesta del bot guardada`)
    } catch (error) {
      console.error("[WHATSAPP] ❌ Error guardando respuesta del bot:", error)
    }

    // Incrementar métricas
    await incrementMetric("messages_sent")
    await updateWhatsAppStats(config.id, { messagesProcessed: 1 })

    console.log(`[WHATSAPP] ✅ Mensaje procesado completamente`)
  } catch (error) {
    console.error(`[WHATSAPP] ❌ Error procesando mensaje:`, error)
    await logError("process_incoming_message", error instanceof Error ? error : new Error(String(error)))

    // Actualizar estadísticas de error
    await updateWhatsAppStats(config.id, { errors: 1 })

    // Enviar mensaje de error al usuario
    try {
      await sendWhatsAppMessage(
        config.phoneNumberId,
        config.accessToken,
        message.from,
        "Lo siento, ha ocurrido un error. Por favor, intenta nuevamente.",
      )
    } catch (sendError) {
      console.error("[WHATSAPP] ❌ Error enviando mensaje de error:", sendError)
    }
  }
}
