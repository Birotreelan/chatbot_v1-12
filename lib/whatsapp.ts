import { sendWhatsAppMessage } from "./whatsapp-api"
import { getWhatsAppConfigByPhoneId, updateWhatsAppStats } from "./db"
import { processWhatsAppMessage } from "./whatsapp-processor"
import { logError, incrementMetric } from "./monitoring"

interface WhatsAppMessage {
  from: string
  text?: { body: string }
  button?: { text: string; payload: string }
  interactive?: {
    type: string
    button_reply?: { id: string; title: string }
    list_reply?: { id: string; title: string }
  }
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

// Función para extraer el contenido del mensaje según su tipo
function extractMessageContent(message: WhatsAppMessage): string {
  console.log(`[WHATSAPP] Extrayendo contenido del mensaje tipo: ${message.type}`)

  switch (message.type) {
    case "text":
      const textContent = message.text?.body || ""
      console.log(`[WHATSAPP] Contenido de texto: "${textContent}"`)
      return textContent
    case "button":
      const buttonContent = message.button?.text || message.button?.payload || ""
      console.log(`[WHATSAPP] Contenido de botón: "${buttonContent}"`)
      return buttonContent
    case "interactive":
      if (message.interactive?.type === "button_reply") {
        const buttonReplyContent = message.interactive.button_reply?.title || message.interactive.button_reply?.id || ""
        console.log(`[WHATSAPP] Contenido de respuesta de botón: "${buttonReplyContent}"`)
        return buttonReplyContent
      } else if (message.interactive?.type === "list_reply") {
        const listReplyContent = message.interactive.list_reply?.title || message.interactive.list_reply?.id || ""
        console.log(`[WHATSAPP] Contenido de respuesta de lista: "${listReplyContent}"`)
        return listReplyContent
      }
      console.log(`[WHATSAPP] Tipo interactivo no reconocido: ${message.interactive?.type}`)
      return ""
    default:
      console.log(`[WHATSAPP] Tipo de mensaje no soportado: ${message.type}`)
      return ""
  }
}

export async function handleMessage(data: WhatsAppWebhookData): Promise<void> {
  console.log("=".repeat(80))
  console.log("[WHATSAPP] ========== PROCESANDO MENSAJE WHATSAPP ==========")
  console.log("[WHATSAPP] Timestamp:", new Date().toISOString())
  console.log("[WHATSAPP] Datos recibidos:", JSON.stringify(data, null, 2))
  console.log("=".repeat(80))

  try {
    // Validar estructura del webhook
    if (!data.messages || data.messages.length === 0) {
      console.log("[WHATSAPP] ⚠️ No hay mensajes para procesar")
      console.log("[WHATSAPP] Estructura de datos:", {
        hasMessages: !!data.messages,
        messagesLength: data.messages?.length || 0,
        hasMetadata: !!data.metadata,
        phoneNumberId: data.metadata?.phone_number_id,
      })
      return
    }

    const message = data.messages[0]
    const phoneNumberId = data.metadata.phone_number_id
    const phoneNumber = message.from

    console.log(`[WHATSAPP] 📱 Procesando mensaje:`)
    console.log(`[WHATSAPP] - De: ${phoneNumber}`)
    console.log(`[WHATSAPP] - Para phoneNumberId: ${phoneNumberId}`)
    console.log(`[WHATSAPP] - Tipo: ${message.type}`)
    console.log(`[WHATSAPP] - ID: ${message.id}`)
    console.log(`[WHATSAPP] - Timestamp: ${message.timestamp}`)

    // Obtener configuración de WhatsApp
    console.log(`[WHATSAPP] 🔍 Buscando configuración para phoneNumberId: ${phoneNumberId}`)
    const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
    if (!config) {
      console.error(`[WHATSAPP] ❌ No se encontró configuración para phoneNumberId: ${phoneNumberId}`)

      // Debug: Listar todas las configuraciones
      const { getAllWhatsAppConfigs } = await import("./db")
      const allConfigs = await getAllWhatsAppConfigs()
      console.log(`[WHATSAPP] 🔍 Configuraciones disponibles (${allConfigs.length}):`)
      allConfigs.forEach((cfg, index) => {
        console.log(`[WHATSAPP]   ${index + 1}. ID: ${cfg.id}`)
        console.log(`[WHATSAPP]      PhoneNumberId: ${cfg.phoneNumberId}`)
        console.log(`[WHATSAPP]      DisplayName: ${cfg.displayName}`)
        console.log(`[WHATSAPP]      Active: ${cfg.active}`)
      })

      await logError("whatsapp_config_not_found", new Error(`Config not found for phone: ${phoneNumberId}`))
      return
    }

    console.log(`[WHATSAPP] ✅ Configuración encontrada:`)
    console.log(`[WHATSAPP] - ID: ${config.id}`)
    console.log(`[WHATSAPP] - DisplayName: ${config.displayName}`)
    console.log(`[WHATSAPP] - ClienteId: ${config.cliente_id}`)
    console.log(`[WHATSAPP] - SedeId: ${config.sede_id}`)
    console.log(`[WHATSAPP] - AssistantId: ${config.whatsappAssistantId}`)
    console.log(`[WHATSAPP] - Active: ${config.active}`)

    // Verificar si la configuración está activa
    if (!config.active) {
      console.warn(`[WHATSAPP] ⚠️ Configuración inactiva, ignorando mensaje`)
      return
    }

    // Obtener nombre del usuario
    const userName = data.contacts?.[0]?.profile?.name || "Usuario"
    console.log(`[WHATSAPP] 👤 Usuario: ${userName} (${phoneNumber})`)

    // Extraer contenido del mensaje
    const messageText = extractMessageContent(message)
    if (!messageText) {
      console.log(`[WHATSAPP] ⚠️ Mensaje sin contenido válido. Tipo: ${message.type}`)
      console.log(`[WHATSAPP] Estructura del mensaje:`, JSON.stringify(message, null, 2))
      return
    }

    console.log(`[WHATSAPP] 💬 Contenido del mensaje: "${messageText}"`)

    // Actualizar estadísticas
    console.log(`[WHATSAPP] 📊 Actualizando estadísticas...`)
    try {
      await updateWhatsAppStats(config.id, { messagesReceived: 1 })
      await incrementMetric("messages_received")
      console.log(`[WHATSAPP] ✅ Estadísticas actualizadas`)
    } catch (statsError) {
      console.error(`[WHATSAPP] Error actualizando estadísticas:`, statsError)
    }

    // Verificar comandos especiales
    const lowerMessage = messageText.toLowerCase().trim()
    if (lowerMessage === "reset" || lowerMessage === "tree reset") {
      console.log(`[WHATSAPP] 🔄 Comando de reset detectado`)
      try {
        // Resetear thread
        const { resetThreadForUser } = await import("./db")
        const resetResult = await resetThreadForUser(phoneNumber, config.id)
        console.log(`[WHATSAPP] ✅ Thread reseteado: ${resetResult.threadId}`)

        // Enviar mensaje de confirmación
        await sendWhatsAppMessage(
          phoneNumberId,
          config.accessToken,
          phoneNumber,
          "Conversación reiniciada. ¿En qué puedo ayudarte?",
        )
        console.log(`[WHATSAPP] ✅ Mensaje de confirmación enviado`)

        // Actualizar estadísticas
        await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
        await incrementMetric("messages_sent")

        return
      } catch (error) {
        console.error("[WHATSAPP] ❌ Error al resetear conversación:", error)

        // Enviar mensaje de error
        try {
          await sendWhatsAppMessage(
            phoneNumberId,
            config.accessToken,
            phoneNumber,
            "No se pudo reiniciar la conversación. Por favor, intenta de nuevo.",
          )
        } catch (sendError) {
          console.error("[WHATSAPP] ❌ Error enviando mensaje de error:", sendError)
        }

        await updateWhatsAppStats(config.id, { errors: 1 })
        return
      }
    }

    console.log("[WHATSAPP] 🤖 Enviando a procesamiento de IA...")

    // Procesar mensaje con IA
    let response: string
    try {
      response = await processWhatsAppMessage(phoneNumber, messageText, userName, message.id, config.id)
      console.log(`[WHATSAPP] ✅ Respuesta generada: ${response.length} caracteres`)
      console.log(`[WHATSAPP] Respuesta preview: "${response.substring(0, 200)}${response.length > 200 ? "..." : ""}"`)
    } catch (aiError) {
      console.error(`[WHATSAPP] ❌ Error en procesamiento de IA:`, aiError)
      response = "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta de nuevo más tarde."
    }

    // Enviar respuesta
    console.log(`[WHATSAPP] 📤 Enviando respuesta por WhatsApp...`)
    try {
      await sendWhatsAppMessage(phoneNumberId, config.accessToken, phoneNumber, response)
      console.log("[WHATSAPP] ✅ Respuesta enviada exitosamente")

      // Actualizar estadísticas de procesamiento
      await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
      await incrementMetric("messages_sent")
    } catch (sendError) {
      console.error("[WHATSAPP] ❌ Error enviando respuesta:", sendError)
      await updateWhatsAppStats(config.id, { errors: 1 })
      throw sendError
    }

    console.log("=".repeat(80))
    console.log("[WHATSAPP] ========== PROCESAMIENTO COMPLETADO ==========")
    console.log("=".repeat(80))
  } catch (error) {
    console.error("=".repeat(80))
    console.error("[WHATSAPP] ❌ ERROR CRÍTICO PROCESANDO MENSAJE:")
    console.error("[WHATSAPP] Error name:", error?.constructor?.name || "Unknown")
    console.error("[WHATSAPP] Error message:", error?.message || "No message")
    console.error("[WHATSAPP] Stack trace:", error instanceof Error ? error.stack : "No stack trace")
    console.error("=".repeat(80))

    await logError("whatsapp_processing", error instanceof Error ? error : new Error(String(error)))
    await incrementMetric("whatsapp_errors")

    // Si tenemos configuración, actualizar estadísticas de error
    if (data.metadata?.phone_number_id) {
      try {
        const config = await getWhatsAppConfigByPhoneId(data.metadata.phone_number_id)
        if (config) {
          await updateWhatsAppStats(config.id, { errors: 1 })

          // Intentar enviar mensaje de error al usuario
          if (data.messages?.[0]?.from) {
            try {
              await sendWhatsAppMessage(
                data.metadata.phone_number_id,
                config.accessToken,
                data.messages[0].from,
                "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta de nuevo más tarde.",
              )
              console.log("[WHATSAPP] ✅ Mensaje de error enviado al usuario")
            } catch (sendError) {
              console.error("[WHATSAPP] ❌ Error enviando mensaje de error al usuario:", sendError)
            }
          }
        }
      } catch (configError) {
        console.error("[WHATSAPP] ❌ Error obteniendo configuración para estadísticas:", configError)
      }
    }

    throw error
  }
}

export async function verifyWebhook(mode: string, token: string, challenge: string): Promise<string | null> {
  console.log("[WHATSAPP] ========== VERIFICANDO WEBHOOK ==========")
  console.log(`[WHATSAPP] Mode: ${mode}`)
  console.log(`[WHATSAPP] Token: ${token?.substring(0, 3)}***`)
  console.log(`[WHATSAPP] Challenge: ${challenge?.substring(0, 10)}...`)

  // Obtener todas las configuraciones para verificar el token
  const { getAllWhatsAppConfigs } = await import("./db")
  const configs = await getAllWhatsAppConfigs()

  console.log(`[WHATSAPP] Verificando contra ${configs.length} configuraciones`)

  // Buscar configuración que coincida con el token
  const matchingConfig = configs.find((config) => config.verifyToken === token)

  if (mode === "subscribe" && matchingConfig) {
    console.log(`[WHATSAPP] ✅ Token verificado para configuración: ${matchingConfig.displayName}`)
    return challenge
  }

  console.log("[WHATSAPP] ❌ Token de verificación inválido")
  console.log("[WHATSAPP] Tokens disponibles:")
  configs.forEach((config, index) => {
    console.log(`[WHATSAPP]   ${index + 1}. ${config.displayName}: ${config.verifyToken?.substring(0, 3)}***`)
  })

  return null
}

// Función para procesar mensajes individuales (para compatibilidad con colas)
export async function processIndividualMessage(
  userMessage: string,
  phoneNumberId: string,
  config: any,
  userPhoneNumber: string,
  messageType?: string,
): Promise<void> {
  console.log(`[WHATSAPP] 🔄 Procesando mensaje individual de ${userPhoneNumber}`)
  console.log(`[WHATSAPP] Mensaje: "${userMessage}"`)
  console.log(`[WHATSAPP] Tipo: ${messageType || "text"}`)

  try {
    // Procesar mensaje con IA
    const response = await processWhatsAppMessage(userPhoneNumber, userMessage, "Usuario", "individual", config.id)

    console.log(`[WHATSAPP] ✅ Respuesta generada: ${response.length} caracteres`)

    // Enviar respuesta
    await sendWhatsAppMessage(phoneNumberId, config.accessToken, userPhoneNumber, response)
    console.log(`[WHATSAPP] ✅ Mensaje individual procesado exitosamente`)
  } catch (error) {
    console.error(`[WHATSAPP] ❌ Error procesando mensaje individual:`, error)
    throw error
  }
}
