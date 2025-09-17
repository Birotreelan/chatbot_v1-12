import { sendWhatsAppMessage } from "./whatsapp-api"
import { getWhatsAppConfigByPhoneId, updateWhatsAppStats } from "./db"
import { processWhatsAppMessage } from "./whatsapp-processor"
import { logError, incrementMetric } from "./monitoring"

interface WhatsAppMessage {
  from: string
  text?: { body: string }
  type: string
  id: string
  timestamp: string
}

interface WhatsAppContact {
  profile: { name: string }
  wa_id: string
}

interface WhatsAppWebhookData {
  messaging_product: string
  metadata: {
    display_phone_number: string
    phone_number_id: string
  }
  contacts?: WhatsAppContact[]
  messages?: WhatsAppMessage[]
}

export async function handleMessage(data: WhatsAppWebhookData): Promise<void> {
  console.log("[WHATSAPP] ========== PROCESANDO WEBHOOK ==========")
  console.log("[WHATSAPP] Datos recibidos:", JSON.stringify(data, null, 2))

  try {
    // Validar estructura del webhook
    if (!data.messages || data.messages.length === 0) {
      console.log("[WHATSAPP] ⚠️ No hay mensajes para procesar")
      return
    }

    const message = data.messages[0]
    const phoneNumberId = data.metadata.phone_number_id
    const phoneNumber = message.from

    console.log(`[WHATSAPP] 📱 Procesando mensaje de ${phoneNumber} para phoneNumberId=${phoneNumberId}`)

    // Obtener configuración de WhatsApp
    const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
    if (!config) {
      console.error(`[WHATSAPP] ❌ No se encontró configuración para phoneNumberId: ${phoneNumberId}`)
      await logError("whatsapp_config_not_found", new Error(`Config not found for phone: ${phoneNumberId}`))
      return
    }

    console.log(`[WHATSAPP] ✅ Configuración encontrada: ${config.displayName} (${config.id})`)

    // Obtener nombre del usuario
    const userName = data.contacts?.[0]?.profile?.name || "Usuario"
    console.log(`[WHATSAPP] 👤 Usuario: ${userName} (${phoneNumber})`)

    // Validar que el mensaje tenga texto
    if (message.type !== "text" || !message.text?.body) {
      console.log(`[WHATSAPP] ⚠️ Mensaje no es de texto o está vacío. Tipo: ${message.type}`)
      return
    }

    const messageText = message.text.body
    console.log(`[WHATSAPP] 💬 Mensaje: "${messageText}"`)

    // Actualizar estadísticas
    await updateWhatsAppStats(config.id, { messagesReceived: 1 })
    await incrementMetric("messages_received")

    console.log("[WHATSAPP] 🤖 Enviando a procesamiento de IA...")

    // Procesar mensaje con IA - CORREGIDO: pasar parámetros correctamente
    const response = await processWhatsAppMessage(phoneNumber, messageText, userName, config, message.id)

    console.log(`[WHATSAPP] ✅ Respuesta generada: ${response.length} caracteres`)

    // Enviar respuesta
    await sendWhatsAppMessage(config.phoneNumberId, config.accessToken, phoneNumber, response)
    console.log("[WHATSAPP] ✅ Respuesta enviada exitosamente")

    // Actualizar estadísticas de procesamiento
    await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
    await incrementMetric("messages_sent")

    console.log("[WHATSAPP] ========== PROCESAMIENTO COMPLETADO ==========")
  } catch (error) {
    console.error("[WHATSAPP] ❌ Error procesando mensaje:", error)
    await logError("whatsapp_processing", error instanceof Error ? error : new Error(String(error)))
    await incrementMetric("whatsapp_errors")

    // Si tenemos configuración, actualizar estadísticas de error
    if (data.metadata?.phone_number_id) {
      const config = await getWhatsAppConfigByPhoneId(data.metadata.phone_number_id)
      if (config) {
        await updateWhatsAppStats(config.id, { errors: 1 })
      }
    }

    throw error
  }
}

export async function verifyWebhook(mode: string, token: string, challenge: string): Promise<string | null> {
  console.log("[WHATSAPP] ========== VERIFICANDO WEBHOOK ==========")
  console.log(`[WHATSAPP] Mode: ${mode}`)
  console.log(`[WHATSAPP] Token: ${token}`)
  console.log(`[WHATSAPP] Challenge: ${challenge}`)

  // Obtener todas las configuraciones para verificar el token
  const { getAllWhatsAppConfigs } = await import("./db")
  const configs = await getAllWhatsAppConfigs()

  // Buscar configuración que coincida con el token
  const matchingConfig = configs.find((config) => config.verifyToken === token)

  if (mode === "subscribe" && matchingConfig) {
    console.log(`[WHATSAPP] ✅ Token verificado para configuración: ${matchingConfig.displayName}`)
    return challenge
  }

  console.log("[WHATSAPP] ❌ Token de verificación inválido")
  return null
}

// Función para procesar mensajes individuales
export async function processIndividualMessage(
  userMessage: string,
  phoneNumberId: string,
  config: any,
  userPhoneNumber: string,
  messageType?: string,
): Promise<void> {
  console.log(`[WHATSAPP] 🔄 Procesando mensaje individual de ${userPhoneNumber}`)

  try {
    // Procesar mensaje con IA
    const response = await processWhatsAppMessage(userPhoneNumber, userMessage, "Usuario", config)

    // Enviar respuesta
    await sendWhatsAppMessage(config.phoneNumberId, config.accessToken, userPhoneNumber, response)

    console.log(`[WHATSAPP] ✅ Mensaje individual procesado exitosamente`)
  } catch (error) {
    console.error(`[WHATSAPP] ❌ Error procesando mensaje individual:`, error)
    throw error
  }
}
