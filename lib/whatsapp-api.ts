// Función para enviar mensajes de texto a través de la API de WhatsApp
export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  text: string,
): Promise<any> {
  const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`

  console.log(`[WHATSAPP-API] Enviando mensaje a ${to}:`, text)
  console.log(`[WHATSAPP-API] URL:`, url)
  console.log(`[WHATSAPP-API] Phone Number ID:`, phoneNumberId)

  // Enviar mensaje a WhatsApp
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
      console.error(`[WHATSAPP-API] Error al enviar mensaje de WhatsApp: ${JSON.stringify(errorData)}`)
      throw new Error(`Error al enviar mensaje de WhatsApp: ${JSON.stringify(errorData)}`)
    }

    const responseData = await response.json()
    console.log(`[WHATSAPP-API] Mensaje enviado exitosamente:`, responseData)
    return responseData
  } catch (error) {
    console.error(`[WHATSAPP-API] Error al enviar mensaje de WhatsApp:`, error)
    throw error
  }
}

// Nueva función para enviar plantillas a través de la API de WhatsApp
export async function sendWhatsAppTemplate(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  templateData: any,
  wabaId?: string,
): Promise<any> {
  // Para plantillas, usar WABA ID si está disponible, sino usar phoneNumberId
  const endpointId = phoneNumberId // Usar siempre Phone Number ID por defecto

  if (wabaId && wabaId !== phoneNumberId) {
    console.warn(`[WHATSAPP-API] WABA ID configurado (${wabaId}) pero usando Phone Number ID por compatibilidad`)
  }

  const url = `https://graph.facebook.com/v18.0/${endpointId}/messages`

  console.log(`[WHATSAPP-API] Enviando plantilla a ${to}:`, templateData)
  console.log(`[WHATSAPP-API] Usando endpoint ID: ${endpointId} (${wabaId ? "WABA ID" : "Phone Number ID"})`)

  try {
    // Si templateData es una cadena, intentamos analizarla como JSON
    let templateBody = templateData
    if (typeof templateData === "string") {
      try {
        templateBody = JSON.parse(templateData)
      } catch (e) {
        console.error("[WHATSAPP-API] Error al analizar la plantilla como JSON:", e)
        throw new Error("El cuerpo de la plantilla debe ser un objeto JSON válido o una cadena JSON válida")
      }
    }

    // Verificar que el cuerpo de la solicitud tenga la estructura correcta
    if (!templateBody.template || !templateBody.template.name) {
      throw new Error("La plantilla debe incluir al menos un nombre en template.name")
    }

    // Asegurarse de que el cuerpo incluya los campos obligatorios
    const requestBody = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      ...templateBody,
    }

    console.log(`[WHATSAPP-API] Enviando plantilla a WhatsApp: ${JSON.stringify(requestBody)}`)

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
      console.error(`[WHATSAPP-API] Error al enviar plantilla de WhatsApp: ${JSON.stringify(errorData)}`)

      // Si el error es por el endpoint, intentar con el otro ID
      if (errorData.error?.code === 100 && wabaId && wabaId !== phoneNumberId) {
        console.log(`[WHATSAPP-API] Reintentando con Phone Number ID: ${phoneNumberId}`)
        return sendWhatsAppTemplate(phoneNumberId, accessToken, to, templateData)
      } else if (errorData.error?.code === 100 && !wabaId) {
        console.log(`[WHATSAPP-API] Error con Phone Number ID, se necesita WABA ID para enviar plantillas`)
        throw new Error(`Error: Para enviar plantillas se requiere configurar el WABA ID. ${errorData.error?.message}`)
      }

      throw new Error(`Error al enviar plantilla de WhatsApp: ${JSON.stringify(errorData)}`)
    }

    const responseData = await response.json()
    console.log(`[WHATSAPP-API] Plantilla enviada exitosamente:`, responseData)
    return responseData
  } catch (error) {
    console.error(`[WHATSAPP-API] Error al enviar plantilla de WhatsApp:`, error)
    throw error
  }
}
