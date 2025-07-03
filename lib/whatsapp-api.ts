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

export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  message: string,
): Promise<WhatsAppMessageResponse> {
  const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`

  console.log(`[WHATSAPP] 📤 Enviando a ${to.slice(-4)}: "${message}"`)

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: {
          body: message,
        },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[WHATSAPP] ❌ Error enviando mensaje: ${response.status} - ${errorText}`)
      throw new Error(`Error enviando mensaje de WhatsApp: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    console.log(`[WHATSAPP] ✅ Mensaje enviado exitosamente`)
    return data
  } catch (error) {
    console.error(`[WHATSAPP] ❌ Error en sendWhatsAppMessage:`, error)
    throw error
  }
}

export async function sendWhatsAppTemplate(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  templateName: string,
  languageCode = "es",
  components?: any[],
): Promise<WhatsAppMessageResponse> {
  const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`

  console.log(`[WHATSAPP] 📤 Enviando template "${templateName}" a ${to.slice(-4)}`)

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to,
        type: "template",
        template: {
          name: templateName,
          language: {
            code: languageCode,
          },
          components: components || [],
        },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[WHATSAPP] ❌ Error enviando template: ${response.status} - ${errorText}`)
      throw new Error(`Error enviando template de WhatsApp: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    console.log(`[WHATSAPP] ✅ Template enviado exitosamente`)
    return data
  } catch (error) {
    console.error(`[WHATSAPP] ❌ Error en sendWhatsAppTemplate:`, error)
    throw error
  }
}

export async function getWhatsAppTemplates(phoneNumberId: string, accessToken: string) {
  const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/message_templates`

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Error obteniendo templates: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    return data
  } catch (error) {
    console.error(`[WHATSAPP] ❌ Error obteniendo templates:`, error)
    throw error
  }
}
