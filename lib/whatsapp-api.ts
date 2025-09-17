interface WhatsAppTextMessage {
  messaging_product: "whatsapp"
  to: string
  type: "text"
  text: {
    body: string
  }
}

export async function sendWhatsAppMessage(
  phoneNumber: string,
  message: string,
  accessToken: string,
  phoneNumberId: string,
): Promise<void> {
  console.log(`[WHATSAPP-API] Enviando mensaje a ${accessToken.substring(0, 20)}...: ${phoneNumberId}`)

  const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`
  console.log(`[WHATSAPP-API] URL: ${url}`)
  console.log(`[WHATSAPP-API] Phone Number ID: ${phoneNumberId}`)

  const payload: WhatsAppTextMessage = {
    messaging_product: "whatsapp",
    to: phoneNumber,
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

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[WHATSAPP-API] Error al enviar mensaje de WhatsApp: ${errorText}`)
      throw new Error(`Error al enviar mensaje de WhatsApp: ${errorText}`)
    }

    const result = await response.json()
    console.log(`[WHATSAPP-API] ✅ Mensaje enviado exitosamente:`, result)
  } catch (error) {
    console.error(`[WHATSAPP-API] Error al enviar mensaje de WhatsApp:`, error)
    throw error
  }
}

export async function getWhatsAppTemplates(accessToken: string, wabaId: string) {
  const url = `https://graph.facebook.com/v18.0/${wabaId}/message_templates`

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      throw new Error(`Error fetching templates: ${response.status}`)
    }

    return await response.json()
  } catch (error) {
    console.error("Error fetching WhatsApp templates:", error)
    throw error
  }
}
