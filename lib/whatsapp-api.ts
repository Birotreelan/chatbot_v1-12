import { logError, incrementMetric } from "./monitoring"

interface WhatsAppMessageResponse {
  messaging_product: string
  contacts: Array<{
    input: string
    wa_id: string
  }>
  messages: Array<{
    id: string
  }>
}

interface WhatsAppTemplateResponse {
  messaging_product: string
  contacts: Array<{
    input: string
    wa_id: string
  }>
  messages: Array<{
    id: string
  }>
}

// Función para enviar mensajes de texto a WhatsApp
export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  message: string,
): Promise<WhatsAppMessageResponse> {
  console.log(`[WHATSAPP-API] 📤 Enviando mensaje a ${to}`)
  console.log(`[WHATSAPP-API] 📱 Phone Number ID: ${phoneNumberId}`)
  console.log(`[WHATSAPP-API] 💬 Mensaje: ${message.substring(0, 100)}${message.length > 100 ? "..." : ""}`)

  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`

  const payload = {
    messaging_product: "whatsapp",
    to: to,
    type: "text",
    text: {
      body: message,
    },
  }

  try {
    console.log(`[WHATSAPP-API] 🌐 Enviando a: ${url}`)

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[WHATSAPP-API] ❌ Error HTTP ${response.status}:`, errorText)

      await logError("whatsapp_send_message", new Error(`HTTP ${response.status}: ${errorText}`))
      await incrementMetric("whatsapp_send_errors")

      throw new Error(`Error enviando mensaje: ${response.status} - ${errorText}`)
    }

    const result = await response.json()
    console.log(`[WHATSAPP-API] ✅ Mensaje enviado exitosamente:`, result)

    await incrementMetric("whatsapp_messages_sent")

    return result
  } catch (error) {
    console.error(`[WHATSAPP-API] ❌ Error enviando mensaje:`, error)

    await logError("whatsapp_send_message", error instanceof Error ? error : new Error(String(error)))
    await incrementMetric("whatsapp_send_errors")

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
  components?: any[],
): Promise<WhatsAppTemplateResponse> {
  console.log(`[WHATSAPP-API] 📤 Enviando plantilla "${templateName}" a ${to}`)
  console.log(`[WHATSAPP-API] 📱 Phone Number ID: ${phoneNumberId}`)
  console.log(`[WHATSAPP-API] 🌐 Idioma: ${languageCode}`)

  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`

  const payload = {
    messaging_product: "whatsapp",
    to: to,
    type: "template",
    template: {
      name: templateName,
      language: {
        code: languageCode,
      },
      ...(components && { components }),
    },
  }

  try {
    console.log(`[WHATSAPP-API] 🌐 Enviando plantilla a: ${url}`)
    console.log(`[WHATSAPP-API] 📋 Payload:`, JSON.stringify(payload, null, 2))

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[WHATSAPP-API] ❌ Error HTTP ${response.status}:`, errorText)

      await logError("whatsapp_send_template", new Error(`HTTP ${response.status}: ${errorText}`))
      await incrementMetric("whatsapp_template_errors")

      throw new Error(`Error enviando plantilla: ${response.status} - ${errorText}`)
    }

    const result = await response.json()
    console.log(`[WHATSAPP-API] ✅ Plantilla enviada exitosamente:`, result)

    await incrementMetric("whatsapp_templates_sent")

    return result
  } catch (error) {
    console.error(`[WHATSAPP-API] ❌ Error enviando plantilla:`, error)

    await logError("whatsapp_send_template", error instanceof Error ? error : new Error(String(error)))
    await incrementMetric("whatsapp_template_errors")

    throw error
  }
}

// Función para obtener plantillas disponibles
export async function getWhatsAppTemplates(wabaId: string, accessToken: string): Promise<any[]> {
  console.log(`[WHATSAPP-API] 📋 Obteniendo plantillas para WABA: ${wabaId}`)

  const url = `https://graph.facebook.com/v21.0/${wabaId}/message_templates`

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
      throw new Error(`Error obteniendo plantillas: ${response.status} - ${errorText}`)
    }

    const result = await response.json()
    console.log(`[WHATSAPP-API] ✅ Plantillas obtenidas:`, result.data?.length || 0)

    return result.data || []
  } catch (error) {
    console.error(`[WHATSAPP-API] ❌ Error obteniendo plantillas:`, error)
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
