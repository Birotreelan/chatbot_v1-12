import { NextResponse } from "next/server"
import { requireAuthFromRequest } from "@/lib/auth"
import { getWhatsAppConfig } from "@/lib/db"
import { sendWhatsAppMessage } from "@/lib/whatsapp-api"
import { saveConversationMessage } from "@/lib/conversations"
import { nanoid } from "nanoid"

/**
 * ── Esta escritura exige sesión (18/11/2026) ───────────────────────────────
 *
 * Segunda tanda de la auditoría: después de cerrar las lecturas críticas
 * quedaban 37 rutas que ESCRIBEN o MANDAN sin verificar nada. El middleware
 * hace CORS y la cookie del SSO, pero no autentica.
 *
 * Mandaba un WhatsApp desde el número de cualquier clínica a cualquier teléfono, con el texto que viniera en el cuerpo.
 *
 * La llama el dashboard desde el navegador, con la cookie de sesión: no hubo
 * que tocar ningún `fetch`.
 */
export async function POST(request: Request) {
  const { session: sesion, error: errorDeSesion } = await requireAuthFromRequest(request as Request)
  if (!sesion) {
    return NextResponse.json({ error: errorDeSesion || "No autorizado" }, { status: 401 })
  }


  try {
    const { configId, phoneNumber, message } = await request.json()

    if (!configId || !phoneNumber || !message) {
      return NextResponse.json({ error: "Faltan parámetros requeridos" }, { status: 400 })
    }

    // Get config
    const config = await getWhatsAppConfig(configId)
    if (!config) {
      return NextResponse.json({ error: "Configuración no encontrada" }, { status: 404 })
    }

    // Send message via WhatsApp
    await sendWhatsAppMessage(config.phoneNumberId, config.accessToken, phoneNumber, message)

    // Save message to conversation history
    await saveConversationMessage({
      id: nanoid(),
      role: "assistant",
      content: message,
      timestamp: new Date().toISOString(),
      phoneNumber: phoneNumber,
      configId: configId,
      messageType: "manual",
    })

    console.log(`[MANUAL-MESSAGE] Mensaje manual enviado a ${phoneNumber}`)

    return NextResponse.json({
      success: true,
      message: "Mensaje enviado exitosamente",
    })
  } catch (error) {
    console.error("[MANUAL-MESSAGE] Error al enviar mensaje manual:", error)
    return NextResponse.json({ error: "Error al enviar mensaje" }, { status: 500 })
  }
}
