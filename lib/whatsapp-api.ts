/**
 * Normaliza un número de teléfono al formato internacional de WhatsApp
 * Ejemplo: "3413121395" -> "5493413121395"
 *
 * Reglas:
 * - Si ya tiene el formato completo (empieza con 549), lo deja como está
 * - Si empieza con 54 pero no tiene el 9 después, lo agrega
 * - Si no tiene código de país, asume Argentina (54) y agrega el 9
 */
function normalizePhoneNumber(phone: string): string {
  // Remover espacios, guiones, paréntesis y el signo +
  const cleaned = phone.replace(/[\s\-()+]/g, "")

  console.log("[v0] [WHATSAPP_API] 📞 Normalizando número:", cleaned)

  // Si ya tiene el formato completo (549XXXXXXXXXX)
  if (cleaned.startsWith("549") && cleaned.length >= 12) {
    console.log("[v0] [WHATSAPP_API] ✅ Número ya tiene formato completo:", cleaned)
    return cleaned
  }

  // Si tiene código de país (54) pero no el 9
  if (cleaned.startsWith("54") && !cleaned.startsWith("549")) {
    const normalized = "549" + cleaned.substring(2)
    console.log("[v0] [WHATSAPP_API] ✅ Número normalizado (agregado 9):", normalized)
    return normalized
  }

  // Si no tiene código de país, agregar 549 (Argentina)
  if (!cleaned.startsWith("54")) {
    const normalized = "549" + cleaned
    console.log("[v0] [WHATSAPP_API] ✅ Número normalizado (agregado 549):", normalized)
    return normalized
  }

  console.log("[v0] [WHATSAPP_API] ⚠️ Usando número sin cambios:", cleaned)
  return cleaned
}

export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  message: string,
): Promise<any> {
  try {
    console.log("[v0] [WHATSAPP_API] 📤 Preparando envío de mensaje")
    console.log("[v0] [WHATSAPP_API] phoneNumberId:", phoneNumberId)
    console.log("[v0] [WHATSAPP_API] to (original):", to)
    console.log("[v0] [WHATSAPP_API] message:", message)
    console.log("[v0] [WHATSAPP_API] accessToken length:", accessToken?.length || 0)
    console.log("[v0] [WHATSAPP_API] accessToken:", accessToken)

    const normalizedPhone = normalizePhoneNumber(to)

    const url = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`
    console.log("[v0] [WHATSAPP_API] URL:", url)

    const payload = {
      messaging_product: "whatsapp",
      to: normalizedPhone, // Usar el número normalizado
      type: "text",
      text: { body: message },
    }
    console.log("[v0] [WHATSAPP_API] Payload:", JSON.stringify(payload, null, 2))

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    console.log("[v0] [WHATSAPP_API] Response status:", response.status)
    console.log("[v0] [WHATSAPP_API] Response ok:", response.ok)

    if (!response.ok) {
      const error = await response.json()
      console.error("[v0] [WHATSAPP_API] ❌ Error response de WhatsApp:", JSON.stringify(error, null, 2))
      throw new Error(`WhatsApp API error: ${JSON.stringify(error)}`)
    }

    const data = await response.json()
    console.log("[v0] [WHATSAPP_API] ✅ Respuesta exitosa de WhatsApp:", JSON.stringify(data, null, 2))
    return data
  } catch (error) {
    console.error("[v0] [WHATSAPP_API] ❌ Error en sendWhatsAppMessage:", error)
    throw error
  }
}

export async function sendWhatsAppTemplate(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  template: any,
  wabaId?: string,
): Promise<any> {
  try {
    console.log("[v0] [WHATSAPP_API] sendWhatsAppTemplate - accessToken:", accessToken)
    const normalizedPhone = normalizePhoneNumber(to)

    const url = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`

    let templateData = template
    if (typeof template === "string") {
      try {
        templateData = JSON.parse(template)
      } catch (e) {
        console.error("[WHATSAPP_API] Error parsing template string:", e)
        throw new Error("Invalid template format")
      }
    }

    const payload = {
      messaging_product: "whatsapp",
      to: normalizedPhone, // Usar el número normalizado
      type: "template",
      template: templateData.template || templateData, // Support both formats
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const error = await response.json()
      console.error("[WHATSAPP_API] Error enviando template:", error)
      throw new Error(`WhatsApp API error: ${JSON.stringify(error)}`)
    }

    const data = await response.json()
    return data
  } catch (error) {
    console.error("[WHATSAPP_API] Error en sendWhatsAppTemplate:", error)
    throw error
  }
}

export async function checkWhatsAppHealth(
  phoneNumberId: string,
  accessToken: string,
): Promise<{
  status: "AVAILABLE" | "LIMITED" | "BLOCKED"
  canSendMessage: boolean
  errors?: any[]
}> {
  try {
    const url = `https://graph.facebook.com/v17.0/${phoneNumberId}`

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const error = await response.json()
      console.error("[WHATSAPP_API] Error verificando health:", error)

      // Analizar el tipo de error
      if (response.status === 403 || response.status === 401) {
        return {
          status: "BLOCKED",
          canSendMessage: false,
          errors: [error],
        }
      }

      return {
        status: "LIMITED",
        canSendMessage: false,
        errors: [error],
      }
    }

    const data = await response.json()

    // Verificar si el número está verificado y puede enviar mensajes
    const isVerified = data.verified_name || data.display_phone_number
    const qualityRating = data.quality_rating || "UNKNOWN"

    // Determinar el estado basado en la respuesta
    let status: "AVAILABLE" | "LIMITED" | "BLOCKED" = "AVAILABLE"
    let canSendMessage = true

    if (qualityRating === "RED" || qualityRating === "FLAGGED") {
      status = "BLOCKED"
      canSendMessage = false
    } else if (qualityRating === "YELLOW") {
      status = "LIMITED"
      canSendMessage = true
    }

    if (!isVerified) {
      status = "LIMITED"
    }

    return {
      status,
      canSendMessage,
      errors: [],
    }
  } catch (error) {
    console.error("[WHATSAPP_API] Error en checkWhatsAppHealth:", error)
    return {
      status: "BLOCKED",
      canSendMessage: false,
      errors: [{ message: error instanceof Error ? error.message : "Error desconocido" }],
    }
  }
}
