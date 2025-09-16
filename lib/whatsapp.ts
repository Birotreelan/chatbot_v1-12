import { sendWhatsAppMessage } from "./whatsapp-api"
import { processWhatsAppMessage } from "./whatsapp-processor"
import { saveConversationMessage } from "./db"

interface WhatsAppWebhookData {
  messaging_product: string
  metadata: {
    display_phone_number: string
    phone_number_id: string
  }
  contacts?: Array<{
    profile: {
      name: string
    }
    wa_id: string
  }>
  messages?: Array<{
    from: string
    id: string
    timestamp: string
    text?: {
      body: string
    }
    type: string
  }>
}

export async function handleMessage(body: WhatsAppWebhookData): Promise<void> {
  console.log("[WHATSAPP] ========== PROCESANDO WEBHOOK ==========")
  console.log("[WHATSAPP] Datos recibidos:", JSON.stringify(body, null, 2))

  try {
    // Verificar que tenemos mensajes
    if (!body.messages || body.messages.length === 0) {
      console.log("[WHATSAPP] ⚠️ No hay mensajes en el webhook")
      return
    }

    // Obtener información del teléfono
    const phoneNumberId = body.metadata?.phone_number_id
    if (!phoneNumberId) {
      console.log("[WHATSAPP] ⚠️ No se encontró phone_number_id")
      return
    }

    // Procesar cada mensaje
    for (const message of body.messages) {
      console.log(`[WHATSAPP] 📨 Procesando mensaje: ${message.id}`)

      // Solo procesar mensajes de texto
      if (message.type !== "text" || !message.text?.body) {
        console.log(`[WHATSAPP] ⚠️ Mensaje no es de texto o está vacío`)
        continue
      }

      const userPhone = message.from
      const messageText = message.text.body
      const messageId = message.id
      const timestamp = new Date(Number.parseInt(message.timestamp) * 1000)

      // Obtener nombre del contacto
      const contact = body.contacts?.find((c) => c.wa_id === userPhone)
      const userName = contact?.profile?.name || userPhone

      console.log(`[WHATSAPP] 👤 Usuario: ${userName} (${userPhone})`)
      console.log(`[WHATSAPP] 💬 Mensaje: "${messageText}"`)

      try {
        // Guardar mensaje entrante
        await saveConversationMessage({
          clientId: userPhone,
          clientName: userName,
          phoneNumberId,
          messageId,
          message: messageText,
          isFromUser: true,
          timestamp,
        })

        console.log("[WHATSAPP] ✅ Mensaje entrante guardado")

        // Procesar mensaje con IA
        const response = await processWhatsAppMessage({
          userPhone,
          userName,
          message: messageText,
          phoneNumberId,
        })

        if (response) {
          console.log(`[WHATSAPP] 🤖 Respuesta generada: "${response}"`)

          // Enviar respuesta
          const sent = await sendWhatsAppMessage(userPhone, response, phoneNumberId)

          if (sent) {
            // Guardar respuesta del bot
            await saveConversationMessage({
              clientId: userPhone,
              clientName: userName,
              phoneNumberId,
              messageId: `bot_${Date.now()}`,
              message: response,
              isFromUser: false,
              timestamp: new Date(),
            })

            console.log("[WHATSAPP] ✅ Respuesta enviada y guardada")
          } else {
            console.log("[WHATSAPP] ❌ Error enviando respuesta")
          }
        } else {
          console.log("[WHATSAPP] ⚠️ No se generó respuesta")
        }
      } catch (error) {
        console.error(`[WHATSAPP] ❌ Error procesando mensaje ${messageId}:`, error)
      }
    }
  } catch (error) {
    console.error("[WHATSAPP] ❌ Error general procesando webhook:", error)
    throw error
  }
}
