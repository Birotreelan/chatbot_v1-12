import { logError } from "./monitoring"

interface WhatsAppMessageResponse {
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

export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  message: string,
): Promise<boolean> {
  console.log(`[WHATSAPP-API] 📤 Enviando mensaje a ${to}`)
  console.log(`[WHATSAPP-API] 📱 Phone Number ID: ${phoneNumberId}`)
  console.log(`[WHATSAPP-API] 💬 Mensaje: ${message.substring(0, 100)}...`)

  try {
    const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`

    const payload: WhatsAppMessageResponse = {
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: {
        body: message,
      },
    }

    console.log(`[WHATSAPP-API] 🌐 URL: ${url}`)
    console.log(`[WHATSAPP-API] 📦 Payload:`, JSON.stringify(payload, null, 2))

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    const responseData = await response.json()

    if (!response.ok) {
      console.error(`[WHATSAPP-API] ❌ Error en respuesta:`, responseData)
      throw new Error(`WhatsApp API error: ${response.status} - ${JSON.stringify(responseData)}`)
    }

    console.log(`[WHATSAPP-API] ✅ Mensaje enviado exitosamente:`, responseData)
    return true
  } catch (error) {
    console.error(`[WHATSAPP-API] ❌ Error enviando mensaje:`, error)
    await logError("whatsapp_send_message", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

export async function sendWhatsAppTemplate(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  templateName: string,
  languageCode = "es",
  parameters: Array<{ type: string; text: string }> = [],
): Promise<boolean> {
  console.log(`[WHATSAPP-API] 📤 Enviando template ${templateName} a ${to}`)

  try {
    const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`

    const payload: WhatsAppMessageResponse = {
      messaging_product: "whatsapp",
      to: to,
      type: "template",
      template: {
        name: templateName,
        language: {
          code: languageCode,
        },
        components:
          parameters.length > 0
            ? [
                {
                  type: "body",
                  parameters: parameters,
                },
              ]
            : undefined,
      },
    }

    console.log(`[WHATSAPP-API] 🌐 URL: ${url}`)
    console.log(`[WHATSAPP-API] 📦 Template Payload:`, JSON.stringify(payload, null, 2))

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    const responseData = await response.json()

    if (!response.ok) {
      console.error(`[WHATSAPP-API] ❌ Error en template:`, responseData)
      throw new Error(`WhatsApp Template API error: ${response.status} - ${JSON.stringify(responseData)}`)
    }

    console.log(`[WHATSAPP-API] ✅ Template enviado exitosamente:`, responseData)
    return true
  } catch (error) {
    console.error(`[WHATSAPP-API] ❌ Error enviando template:`, error)
    await logError("whatsapp_send_template", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

export async function getWhatsAppTemplates(phoneNumberId: string, accessToken: string): Promise<any[]> {
  console.log(`[WHATSAPP-API] 📋 Obteniendo templates para ${phoneNumberId}`)

  try {
    const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/message_templates`

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    })

    const responseData = await response.json()

    if (!response.ok) {
      console.error(`[WHATSAPP-API] ❌ Error obteniendo templates:`, responseData)
      throw new Error(`WhatsApp Templates API error: ${response.status} - ${JSON.stringify(responseData)}`)
    }

    console.log(`[WHATSAPP-API] ✅ Templates obtenidos:`, responseData.data?.length || 0)
    return responseData.data || []
  } catch (error) {
    console.error(`[WHATSAPP-API] ❌ Error obteniendo templates:`, error)
    await logError("whatsapp_get_templates", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

export async function validateWhatsAppConfig(phoneNumberId: string, accessToken: string): Promise<boolean> {
  console.log(`[WHATSAPP-API] 🔍 Validando configuración para ${phoneNumberId}`)

  try {
    const url = `https://graph.facebook.com/v18.0/${phoneNumberId}`

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    })

    const responseData = await response.json()

    if (!response.ok) {
      console.error(`[WHATSAPP-API] ❌ Error validando configuración:`, responseData)
      return false
    }

    console.log(`[WHATSAPP-API] ✅ Configuración válida:`, responseData)
    return true
  } catch (error) {
    console.error(`[WHATSAPP-API] ❌ Error validando configuración:`, error)
    return false
  }
}
