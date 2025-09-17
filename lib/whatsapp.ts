import { getWhatsAppConfigByPhoneId, updateWhatsAppStats } from "./db"
import { processWhatsAppMessage } from "./whatsapp-processor"
import { logError } from "./monitoring"

interface WhatsAppWebhookData {
  messaging_product: string
  metadata: {
    display_phone_number: string
    phone_number_id: string
  }
  contacts: Array<{
    profile: {
      name: string
    }
    wa_id: string
  }>
  messages: Array<{
    from: string
    id: string
    timestamp: string
    text: {
      body: string
    }
    type: string
  }>
}

export async function processWhatsAppWebhook(data: WhatsAppWebhookData) {
  console.log("[WHATSAPP] ========== PROCESANDO WEBHOOK ==========")
  console.log("[WHATSAPP] Datos recibidos:", JSON.stringify(data, null, 2))

  try {
    // Validar estructura básica
    if (!data.messages || data.messages.length === 0) {
      console.log("[WHATSAPP] ⚠️ No hay mensajes para procesar")
      return { success: true, message: "No messages to process" }
    }

    const message = data.messages[0]
    const contact = data.contacts?.[0]
    const phoneNumberId = data.metadata.phone_number_id

    console.log(`[WHATSAPP] 📱 Procesando mensaje de ${message.from} para phoneNumberId=${phoneNumberId}`)

    // Obtener configuración por phoneNumberId
    const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
    if (!config) {
      console.error(`[WHATSAPP] ❌ No se encontró configuración para phoneNumberId: ${phoneNumberId}`)
      throw new Error(`No configuration found for phoneNumberId: ${phoneNumberId}`)
    }

    console.log(`[WHATSAPP] ✅ Configuración encontrada: ${config.displayName} (${config.id})`)
    console.log(`[WHATSAPP] 👤 Usuario: ${contact?.profile?.name || "Sin nombre"} (${message.from})`)
    console.log(`[WHATSAPP] 💬 Mensaje: "${message.text?.body || "Sin texto"}"`)

    // Actualizar estadísticas de mensajes recibidos
    await updateWhatsAppStats(config.id, {
      messagesReceived: 1,
      lastMessageAt: new Date().toISOString(),
    })

    // Solo procesar mensajes de texto
    if (message.type !== "text" || !message.text?.body) {
      console.log(`[WHATSAPP] ⚠️ Tipo de mensaje no soportado: ${message.type}`)
      return { success: true, message: "Message type not supported" }
    }

    console.log("[WHATSAPP] 🤖 Enviando a procesamiento de IA...")

    // Procesar el mensaje con IA
    const response = await processWhatsAppMessage(
      message.from, // phoneNumber
      message.text.body, // message
      contact?.profile?.name || "Usuario", // userName
      message.id, // messageId
      config.id, // whatsappConfigId - ESTE ES EL CORRECTO
    )

    console.log("[WHATSAPP] ✅ Mensaje procesado exitosamente")
    return { success: true, response }
  } catch (error) {
    console.error("[WHATSAPP] ❌ Error procesando mensaje:", error)
    await logError("whatsapp_webhook", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

// Función para procesar mensajes individuales (para compatibilidad)
export async function processIndividualMessage(
  message: string,
  phoneNumberId: string,
  userPhoneNumber: string,
  assistantId?: string,
) {
  console.log(`[WHATSAPP] 📱 Procesando mensaje individual para ${userPhoneNumber}`)

  try {
    // Obtener la configuración
    const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
    if (!config) {
      throw new Error(`No se encontró configuración para phoneNumberId: ${phoneNumberId}`)
    }

    // Procesar con el procesador de WhatsApp
    const result = await processWhatsAppMessage(userPhoneNumber, message, "Usuario", `msg_${Date.now()}`, config.id)

    return result
  } catch (error) {
    console.error("[WHATSAPP] ❌ Error en processIndividualMessage:", error)
    await logError("process_individual_message", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}
