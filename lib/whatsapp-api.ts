import { logError } from "./monitoring"

interface WhatsAppTextMessage {
  messaging_product: "whatsapp"
  to: string
  type: "text"
  text: {
    body: string
  }
}

interface WhatsAppTemplateMessage {
  messaging_product: "whatsapp"
  to: string
  type: "template"
  template: {
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

// Función para enviar mensajes de texto a WhatsApp
export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  message: string,
): Promise<any> {
  console.log(`[WHATSAPP-API] 📤 Enviando mensaje a ${to}`)
  console.log(`[WHATSAPP-API] 📱 Phone Number ID: ${phoneNumberId}`)
  console.log(`[WHATSAPP-API] 💬 Mensaje: "${message.substring(0, 100)}${message.length > 100 ? "..." : ""}"`)

  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`

  const payload: WhatsAppTextMessage = {
    messaging_product: "whatsapp",
    to: to,
    type: "text",
    text: {
      body: message,
    },
  }

  try {
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
      console.error(`[WHATSAPP-API] ❌ Error enviando mensaje:`, responseData)
      throw new Error(`WhatsApp API error: ${response.status} - ${JSON.stringify(responseData)}`)
    }

    console.log(`[WHATSAPP-API] ✅ Mensaje enviado exitosamente:`, responseData)
    return responseData
  } catch (error) {
    console.error(`[WHATSAPP-API] ❌ Error en sendWhatsAppMessage:`, error)
    await logError("whatsapp_send_message", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

// Función para enviar plantillas de WhatsApp
export async function sendWhatsAppTemplate(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  templateName: string,
  languageCode = "es",
  parameters: Array<{ type: string; text: string }> = [],
): Promise<any> {
  console.log(`[WHATSAPP-API] 📤 Enviando template "${templateName}" a ${to}`)
  console.log(`[WHATSAPP-API] 📱 Phone Number ID: ${phoneNumberId}`)
  console.log(`[WHATSAPP-API] 🌐 Idioma: ${languageCode}`)
  console.log(`[WHATSAPP-API] 📋 Parámetros:`, parameters)

  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`

  const payload: WhatsAppTemplateMessage = {
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

  // Agregar componentes si hay parámetros
  if (parameters.length > 0) {
    payload.template.components = [
      {
        type: "body",
        parameters: parameters,
      },
    ]
  }

  try {
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
      console.error(`[WHATSAPP-API] ❌ Error enviando template:`, responseData)
      throw new Error(`WhatsApp API error: ${response.status} - ${JSON.stringify(responseData)}`)
    }

    console.log(`[WHATSAPP-API] ✅ Template enviado exitosamente:`, responseData)
    return responseData
  } catch (error) {
    console.error(`[WHATSAPP-API] ❌ Error en sendWhatsAppTemplate:`, error)
    await logError("whatsapp_send_template", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

// Función para obtener plantillas disponibles
export async function getWhatsAppTemplates(phoneNumberId: string, accessToken: string): Promise<any> {
  console.log(`[WHATSAPP-API] 📋 Obteniendo templates para ${phoneNumberId}`)

  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/message_templates`

  try {
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
      throw new Error(`WhatsApp API error: ${response.status} - ${JSON.stringify(responseData)}`)
    }

    console.log(`[WHATSAPP-API] ✅ Templates obtenidos exitosamente:`, responseData)
    return responseData
  } catch (error) {
    console.error(`[WHATSAPP-API] ❌ Error en getWhatsAppTemplates:`, error)
    await logError("whatsapp_get_templates", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

// Función para verificar el estado de un número de teléfono
export async function verifyPhoneNumber(phoneNumberId: string, accessToken: string): Promise<any> {
  console.log(`[WHATSAPP-API] 🔍 Verificando número de teléfono: ${phoneNumberId}`)

  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}`

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[WHATSAPP-API] ❌ Error HTTP ${response.status}:`, errorText)
      throw new Error(`Error verificando número: ${response.status} - ${errorText}`)
    }

    const result = await response.json()
    console.log(`[WHATSAPP-API] ✅ Número verificado:`, result)

    return result
  } catch (error) {
    console.error(`[WHATSAPP-API] ❌ Error verificando número:`, error)
    throw error
  }
}
