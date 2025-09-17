import { logError, incrementMetric } from "./monitoring"

interface WhatsAppTemplate {
  name: string
  language: string
  status: string
  category: string
  components: any[]
}

interface WhatsAppTemplateResponse {
  data: WhatsAppTemplate[]
}

interface WhatsAppMessage {
  messaging_product: string
  to: string
  type: string
  text?: {
    body: string
  }
  template?: {
    name: string
    language: {
      code: string
    }
    components?: Array<{
      type: string
      parameters: Array<{
        type: string
        text: string
      }>
    }>
  }
}

interface WhatsAppResponse {
  messaging_product: string
  contacts: Array<{
    input: string
    wa_id: string
  }>
  messages: Array<{
    id: string
  }>
}

class WhatsAppAPILogger {
  private context: string

  constructor(context: string) {
    this.context = context
  }

  log(level: "INFO" | "ERROR" | "WARN" | "DEBUG", message: string, data?: any) {
    const timestamp = new Date().toISOString()
    const prefix = `[${this.context}] [${level}]`

    if (data) {
      console.log(`${prefix} ${message}`, JSON.stringify(data, null, 2))
    } else {
      console.log(`${prefix} ${message}`)
    }
  }

  info(message: string, data?: any) {
    this.log("INFO", message, data)
  }
  error(message: string, data?: any) {
    this.log("ERROR", message, data)
  }
  warn(message: string, data?: any) {
    this.log("WARN", message, data)
  }
  debug(message: string, data?: any) {
    this.log("DEBUG", message, data)
  }
}

// Función principal para enviar mensajes de WhatsApp
export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  message: string,
  maxRetries = 3,
): Promise<WhatsAppResponse> {
  const logger = new WhatsAppAPILogger("WHATSAPP-API")

  logger.info("Enviando mensaje de WhatsApp", {
    phoneNumberId,
    to,
    messageLength: message.length,
    maxRetries,
  })

  const url = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`

  const payload: WhatsAppMessage = {
    messaging_product: "whatsapp",
    to: to,
    type: "text",
    text: {
      body: message,
    },
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  }

  logger.debug("Payload y headers preparados", { payload, headers: { ...headers, Authorization: "Bearer [HIDDEN]" } })

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`Intento ${attempt}/${maxRetries} - Enviando mensaje...`)

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      })

      const responseText = await response.text()
      logger.debug("Respuesta cruda de WhatsApp API", {
        status: response.status,
        statusText: response.statusText,
        responseText: responseText.substring(0, 500),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${responseText}`)
      }

      const data = JSON.parse(responseText) as WhatsAppResponse
      logger.info("Mensaje enviado exitosamente", {
        messageId: data.messages?.[0]?.id,
        waId: data.contacts?.[0]?.wa_id,
      })

      await incrementMetric("whatsapp_messages_sent")
      return data
    } catch (error) {
      logger.error(`Error en intento ${attempt}`, { error: error.message })

      if (attempt === maxRetries) {
        logger.error("Todos los intentos fallaron", { error })
        await logError("whatsapp_send_message", error instanceof Error ? error : new Error(String(error)))
        await incrementMetric("whatsapp_send_errors")
        throw new Error(`Failed to send WhatsApp message after ${maxRetries} attempts: ${error.message}`)
      }

      // Esperar antes del siguiente intento
      const delay = Math.pow(2, attempt) * 1000 // Backoff exponencial
      logger.info(`Esperando ${delay}ms antes del siguiente intento...`)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw new Error("Unexpected error in sendWhatsAppMessage")
}

// Función para enviar plantillas de WhatsApp
export async function sendWhatsAppTemplate(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  templateName: string,
  languageCode = "es",
  parameters: string[] = [],
): Promise<WhatsAppResponse> {
  const logger = new WhatsAppAPILogger("WHATSAPP-TEMPLATE")

  logger.info("Enviando template de WhatsApp", {
    phoneNumberId,
    to,
    templateName,
    languageCode,
    parametersCount: parameters.length,
  })

  const url = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`

  const payload: WhatsAppMessage = {
    messaging_product: "whatsapp",
    to: to,
    type: "template",
    template: {
      name: templateName,
      language: {
        code: languageCode,
      },
    },
  }

  // Agregar parámetros si existen
  if (parameters.length > 0) {
    payload.template!.components = [
      {
        type: "body",
        parameters: parameters.map((param) => ({
          type: "text",
          text: param,
        })),
      },
    ]
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  }

  try {
    logger.debug("Enviando template...", { payload })

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    })

    const responseText = await response.text()

    if (!response.ok) {
      logger.error("Error enviando template", {
        status: response.status,
        responseText,
      })
      await logError("whatsapp_send_template", new Error(`HTTP ${response.status}: ${responseText}`))
      await incrementMetric("whatsapp_template_errors")
      throw new Error(`HTTP ${response.status}: ${responseText}`)
    }

    const data = JSON.parse(responseText) as WhatsAppResponse
    logger.info("Template enviado exitosamente", {
      messageId: data.messages?.[0]?.id,
    })

    await incrementMetric("whatsapp_templates_sent")
    return data
  } catch (error) {
    logger.error("Error enviando template", { error })
    await logError("whatsapp_send_template", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

// Función para obtener plantillas de WhatsApp
export async function getWhatsAppTemplates(businessAccountId: string, accessToken: string): Promise<any> {
  const logger = new WhatsAppAPILogger("WHATSAPP-TEMPLATES")

  logger.info("Obteniendo templates de WhatsApp", { businessAccountId })

  const url = `https://graph.facebook.com/v17.0/${businessAccountId}/message_templates`

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
    })

    const responseText = await response.text()

    if (!response.ok) {
      logger.error("Error obteniendo templates", {
        status: response.status,
        responseText,
      })
      await logError("whatsapp_get_templates", new Error(`HTTP ${response.status}: ${responseText}`))
      throw new Error(`HTTP ${response.status}: ${responseText}`)
    }

    const data = JSON.parse(responseText)
    logger.info("Templates obtenidos exitosamente", {
      count: data.data?.length || 0,
    })

    return data
  } catch (error) {
    logger.error("Error obteniendo templates", { error })
    await logError("whatsapp_get_templates", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

// Función para validar configuración de WhatsApp
export async function validateWhatsAppConfig(
  phoneNumberId: string,
  accessToken: string,
): Promise<{ valid: boolean; error?: string }> {
  const logger = new WhatsAppAPILogger("WHATSAPP-CONFIG")

  logger.info("Validando configuración para Phone Number ID", { phoneNumberId })

  const url = `https://graph.facebook.com/v17.0/${phoneNumberId}`

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
    })

    const responseText = await response.text()

    if (!response.ok) {
      const errorMessage = `Invalid WhatsApp config: ${response.status} - ${responseText}`
      logger.error(errorMessage)
      await logError("whatsapp_validate_config", new Error(errorMessage))
      return { valid: false, error: errorMessage }
    }

    const data = JSON.parse(responseText)
    logger.info("Configuración válida", {
      id: data.id,
      displayPhoneNumber: data.display_phone_number,
      verifiedName: data.verified_name,
    })

    return { valid: true }
  } catch (error) {
    const errorMessage = `Validation error: ${error instanceof Error ? error.message : String(error)}`
    logger.error(errorMessage)
    await logError("whatsapp_validate_config", error instanceof Error ? error : new Error(String(error)))
    return { valid: false, error: errorMessage }
  }
}

// Función para obtener información del número de teléfono
export async function getPhoneNumberInfo(phoneNumberId: string, accessToken: string): Promise<any> {
  const logger = new WhatsAppAPILogger("WHATSAPP-PHONE-INFO")

  logger.info("Obteniendo información del número", { phoneNumberId })

  const url = `https://graph.facebook.com/v17.0/${phoneNumberId}?fields=id,display_phone_number,verified_name,code_verification_status,quality_rating`

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
    })

    const responseText = await response.text()

    if (!response.ok) {
      throw new Error(`Phone info API error: ${response.status} - ${responseText}`)
    }

    const data = JSON.parse(responseText)
    logger.info("Información del número obtenida", data)

    return data
  } catch (error) {
    logger.error("Error obteniendo información del número", { error })
    await logError("whatsapp_get_phone_info", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

// Función para marcar mensaje como leído
export async function markMessageAsRead(
  phoneNumberId: string,
  accessToken: string,
  messageId: string,
): Promise<boolean> {
  const logger = new WhatsAppAPILogger("WHATSAPP-MARK-READ")

  logger.info("Marcando mensaje como leído", { messageId })

  const url = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`

  const payload = {
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    })

    const responseText = await response.text()

    if (!response.ok) {
      throw new Error(`Mark read API error: ${response.status} - ${responseText}`)
    }

    logger.info("Mensaje marcado como leído")
    return true
  } catch (error) {
    logger.error("Error marcando mensaje como leído", { error })
    await logError("whatsapp_mark_read", error instanceof Error ? error : new Error(String(error)))
    return false
  }
}

// Función para validar número de teléfono
export function validatePhoneNumber(phoneNumber: string): boolean {
  // Remover espacios y caracteres especiales
  const cleaned = phoneNumber.replace(/[\s\-$$$$]/g, "")

  // Verificar que sea un número válido (solo dígitos, posiblemente con +)
  const phoneRegex = /^\+?[1-9]\d{1,14}$/

  return phoneRegex.test(cleaned)
}

// Función para formatear número de teléfono
export function formatPhoneNumber(phoneNumber: string): string {
  // Remover espacios y caracteres especiales
  let cleaned = phoneNumber.replace(/[\s\-$$$$]/g, "")

  // Agregar código de país si no existe
  if (!cleaned.startsWith("+")) {
    if (cleaned.startsWith("54")) {
      cleaned = "+" + cleaned
    } else if (cleaned.startsWith("9")) {
      cleaned = "+54" + cleaned
    } else {
      cleaned = "+549" + cleaned
    }
  }

  return cleaned
}

// Exportar funciones con alias para compatibilidad
export { sendWhatsAppMessage as sendMessage }
export { sendWhatsAppTemplate as sendTemplate }
export { getWhatsAppTemplates as getTemplates }
