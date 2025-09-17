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

// Función principal para enviar mensajes de WhatsApp
export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  message: string,
): Promise<boolean> {
  console.log(`[WHATSAPP-API] 📤 Enviando mensaje a ${to}`)
  console.log(`[WHATSAPP-API] 📱 Phone Number ID: ${phoneNumberId}`)
  console.log(`[WHATSAPP-API] 💬 Mensaje: "${message.substring(0, 100)}${message.length > 100 ? "..." : ""}"`)

  try {
    const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`

    const payload = {
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

    const responseText = await response.text()
    console.log(`[WHATSAPP-API] 📥 Response Status: ${response.status}`)
    console.log(`[WHATSAPP-API] 📥 Response Body: ${responseText}`)

    if (!response.ok) {
      throw new Error(`WhatsApp API error: ${response.status} - ${responseText}`)
    }

    const data = JSON.parse(responseText)
    console.log(`[WHATSAPP-API] ✅ Mensaje enviado exitosamente. Message ID: ${data.messages?.[0]?.id}`)

    await incrementMetric("whatsapp_messages_sent")
    return true
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
): Promise<boolean> {
  console.log(`[WHATSAPP-API] 📤 Enviando plantilla ${templateName} a ${to}`)

  try {
    const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`

    const payload = {
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
    }

    console.log(`[WHATSAPP-API] 📦 Template Payload:`, JSON.stringify(payload, null, 2))

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    const responseText = await response.text()
    console.log(`[WHATSAPP-API] 📥 Template Response: ${response.status} - ${responseText}`)

    if (!response.ok) {
      throw new Error(`WhatsApp Template API error: ${response.status} - ${responseText}`)
    }

    const data = JSON.parse(responseText)
    console.log(`[WHATSAPP-API] ✅ Plantilla enviada exitosamente. Message ID: ${data.messages?.[0]?.id}`)

    await incrementMetric("whatsapp_templates_sent")
    return true
  } catch (error) {
    console.error(`[WHATSAPP-API] ❌ Error enviando plantilla:`, error)
    await logError("whatsapp_send_template", error instanceof Error ? error : new Error(String(error)))
    await incrementMetric("whatsapp_template_errors")
    throw error
  }
}

// Función para obtener plantillas de WhatsApp
export async function getWhatsAppTemplates(wabaId: string, accessToken: string): Promise<WhatsAppTemplate[]> {
  console.log(`[WHATSAPP-API] 📋 Obteniendo plantillas para WABA ID: ${wabaId}`)

  try {
    const url = `https://graph.facebook.com/v18.0/${wabaId}/message_templates`

    console.log(`[WHATSAPP-API] 🌐 Templates URL: ${url}`)

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    })

    const responseText = await response.text()
    console.log(`[WHATSAPP-API] 📥 Templates Response: ${response.status}`)

    if (!response.ok) {
      throw new Error(`WhatsApp Templates API error: ${response.status} - ${responseText}`)
    }

    const data: WhatsAppTemplateResponse = JSON.parse(responseText)
    console.log(`[WHATSAPP-API] ✅ ${data.data?.length || 0} plantillas obtenidas`)

    return data.data || []
  } catch (error) {
    console.error(`[WHATSAPP-API] ❌ Error obteniendo plantillas:`, error)
    await logError("whatsapp_get_templates", error instanceof Error ? error : new Error(String(error)))
    return []
  }
}

// Función para validar configuración de WhatsApp
export async function validateWhatsAppConfig(
  phoneNumberId: string,
  accessToken: string,
): Promise<{ valid: boolean; error?: string }> {
  console.log(`[WHATSAPP-API] 🔍 Validando configuración para Phone Number ID: ${phoneNumberId}`)

  try {
    const url = `https://graph.facebook.com/v18.0/${phoneNumberId}`

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    })

    const responseText = await response.text()
    console.log(`[WHATSAPP-API] 📥 Validation Response: ${response.status}`)

    if (!response.ok) {
      const errorMessage = `Invalid WhatsApp config: ${response.status} - ${responseText}`
      console.error(`[WHATSAPP-API] ❌ ${errorMessage}`)
      return { valid: false, error: errorMessage }
    }

    const data = JSON.parse(responseText)
    console.log(`[WHATSAPP-API] ✅ Configuración válida:`, {
      id: data.id,
      displayPhoneNumber: data.display_phone_number,
      verifiedName: data.verified_name,
    })

    return { valid: true }
  } catch (error) {
    const errorMessage = `Validation error: ${error instanceof Error ? error.message : String(error)}`
    console.error(`[WHATSAPP-API] ❌ ${errorMessage}`)
    await logError("whatsapp_validate_config", error instanceof Error ? error : new Error(String(error)))
    return { valid: false, error: errorMessage }
  }
}

// Función para obtener información del número de teléfono
export async function getPhoneNumberInfo(phoneNumberId: string, accessToken: string): Promise<any> {
  console.log(`[WHATSAPP-API] 📞 Obteniendo información del número: ${phoneNumberId}`)

  try {
    const url = `https://graph.facebook.com/v18.0/${phoneNumberId}?fields=id,display_phone_number,verified_name,code_verification_status,quality_rating`

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    })

    const responseText = await response.text()
    console.log(`[WHATSAPP-API] 📥 Phone Info Response: ${response.status}`)

    if (!response.ok) {
      throw new Error(`Phone info API error: ${response.status} - ${responseText}`)
    }

    const data = JSON.parse(responseText)
    console.log(`[WHATSAPP-API] ✅ Información del número obtenida:`, data)

    return data
  } catch (error) {
    console.error(`[WHATSAPP-API] ❌ Error obteniendo información del número:`, error)
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
  console.log(`[WHATSAPP-API] 👁️ Marcando mensaje como leído: ${messageId}`)

  try {
    const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`

    const payload = {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    const responseText = await response.text()
    console.log(`[WHATSAPP-API] 📥 Mark Read Response: ${response.status}`)

    if (!response.ok) {
      throw new Error(`Mark read API error: ${response.status} - ${responseText}`)
    }

    console.log(`[WHATSAPP-API] ✅ Mensaje marcado como leído`)
    return true
  } catch (error) {
    console.error(`[WHATSAPP-API] ❌ Error marcando mensaje como leído:`, error)
    await logError("whatsapp_mark_read", error instanceof Error ? error : new Error(String(error)))
    return false
  }
}
