import { logger } from "./logger"

export async function checkWhatsAppHealth(
  phoneNumberId: string,
  accessToken: string,
): Promise<{
  status: "AVAILABLE" | "LIMITED" | "BLOCKED"
  canSendMessage: "AVAILABLE" | "RATE_LIMITED" | "FLAGGED" | "RESTRICTED" | "UNAVAILABLE"
  errors?: Array<{ errorCode: number; errorDescription: string; possibleSolution: string }>
}> {
  const url = `https://graph.facebook.com/v18.0/${phoneNumberId}?fields=health_status`

  logger.info("WHATSAPP-API", `Verificando health status para ${phoneNumberId}`)

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorData = await response.json()
      logger.error("WHATSAPP-API", "Error verificando health status", errorData)
      throw new Error(`Error al verificar health status: ${JSON.stringify(errorData)}`)
    }

    const data = await response.json()
    logger.info("WHATSAPP-API", `Health status obtenido: ${JSON.stringify(data)}`)

    // Extract health status from response
    const healthStatus = data.health_status || {}
    const status = healthStatus.status || "AVAILABLE"
    const canSendMessage = healthStatus.can_send_message || "AVAILABLE"
    const errors = healthStatus.errors || []

    return {
      status,
      canSendMessage,
      errors,
    }
  } catch (error) {
    logger.error("WHATSAPP-API", "Error en checkWhatsAppHealth", error)
    throw error
  }
}
// </CHANGE>

export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  text: string,
): Promise<any> {
  const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`

  logger.info("WHATSAPP-API", `Enviando mensaje a ${to} (${text.length} chars)`)

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: {
          preview_url: false,
          body: text,
        },
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      logger.error("WHATSAPP-API", "Error enviando mensaje", errorData)
      throw new Error(`Error al enviar mensaje de WhatsApp: ${JSON.stringify(errorData)}`)
    }

    const responseData = await response.json()
    logger.info("WHATSAPP-API", `Mensaje enviado ✓: ${responseData.messages?.[0]?.id}`)
    return responseData
  } catch (error) {
    logger.error("WHATSAPP-API", "Error en sendWhatsAppMessage", error)
    throw error
  }
}

export async function sendWhatsAppTemplate(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  templateData: any,
  wabaId?: string,
): Promise<any> {
  const endpointId = phoneNumberId

  logger.info("WHATSAPP-API", `Enviando plantilla a ${to}`)

  const url = `https://graph.facebook.com/v18.0/${endpointId}/messages`

  try {
    let templateBody = templateData
    if (typeof templateData === "string") {
      try {
        templateBody = JSON.parse(templateData)
      } catch (e) {
        logger.error("WHATSAPP-API", "Error parseando plantilla")
        throw new Error("El cuerpo de la plantilla debe ser un objeto JSON válido o una cadena JSON válida")
      }
    }

    if (!templateBody.template || !templateBody.template.name) {
      throw new Error("La plantilla debe incluir al menos un nombre en template.name")
    }

    const requestBody = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      ...templateBody,
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorData = await response.json()
      logger.error("WHATSAPP-API", "Error enviando plantilla", errorData)

      if (errorData.error?.code === 100 && wabaId && wabaId !== phoneNumberId) {
        logger.info("WHATSAPP-API", "Reintentando con Phone Number ID")
        return sendWhatsAppTemplate(phoneNumberId, accessToken, to, templateData)
      } else if (errorData.error?.code === 100 && !wabaId) {
        throw new Error(`Error: Para enviar plantillas se requiere configurar el WABA ID. ${errorData.error?.message}`)
      }

      throw new Error(`Error al enviar plantilla de WhatsApp: ${JSON.stringify(errorData)}`)
    }

    const responseData = await response.json()
    logger.info("WHATSAPP-API", `Plantilla enviada ✓: ${responseData.messages?.[0]?.id}`)
    return responseData
  } catch (error) {
    logger.error("WHATSAPP-API", "Error en sendWhatsAppTemplate", error)
    throw error
  }
}
