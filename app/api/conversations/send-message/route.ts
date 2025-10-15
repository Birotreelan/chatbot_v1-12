import { NextResponse } from "next/server"
import { getWhatsAppConfigById } from "@/lib/db"
import { sendWhatsAppMessage } from "@/lib/whatsapp-api"
import { saveConversationMessage } from "@/lib/conversations"
import { nanoid } from "nanoid"

export async function POST(request: Request) {
  try {
    const { configId, phoneNumber, message } = await request.json()

    console.log("[API] POST /api/conversations/send-message")
    console.log("[API]   - configId:", configId)
    console.log("[API]   - phoneNumber:", phoneNumber)
    console.log("[API]   - message:", message)

    if (!configId || !phoneNumber || !message) {
      return NextResponse.json({ error: "configId, phoneNumber y message son requeridos" }, { status: 400 })
    }

    // Get config to access WhatsApp credentials
    const config = await getWhatsAppConfigById(configId)
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
      phoneNumber,
      configId,
      messageType: "manual",
    })

    console.log("[API] ✅ Mensaje manual enviado exitosamente")

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[API] ❌ Error enviando mensaje manual:", error)
    return NextResponse.json({ error: "Error enviando mensaje" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"
