import { NextResponse } from "next/server"
import { getWhatsAppConfig } from "@/lib/db"
import { sendWhatsAppMessage } from "@/lib/whatsapp-api"
import { saveConversationMessage } from "@/lib/conversations"
import { nanoid } from "nanoid"

export async function POST(request: Request) {
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
