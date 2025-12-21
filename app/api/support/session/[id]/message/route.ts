import { NextResponse } from "next/server"
import { requireSupportAgent } from "@/lib/auth"
import { getSupportSession, saveSupportMessage } from "@/lib/human-support"
import { getWhatsAppConfigById } from "@/lib/db"
import { sendWhatsAppMessage } from "@/lib/whatsapp-api"
import { nanoid } from "nanoid"
import type { HumanSupportMessage } from "@/lib/types"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSupportAgent()
    const { id: sessionId } = await params
    const { message } = await request.json()

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return NextResponse.json({ success: false, error: "Mensaje inválido" }, { status: 400 })
    }

    const supportSession = await getSupportSession(sessionId)

    if (!supportSession) {
      return NextResponse.json({ success: false, error: "Sesión no encontrada" }, { status: 404 })
    }

    // Verificar permisos: solo el agente asignado puede enviar mensajes
    if (supportSession.assignedTo !== session.userId) {
      return NextResponse.json({ success: false, error: "No estás asignado a esta sesión" }, { status: 403 })
    }

    // Verificar que la sesión está en progreso
    if (supportSession.status !== "in_progress") {
      return NextResponse.json({ success: false, error: "Sesión no está activa" }, { status: 400 })
    }

    // Obtener configuración de WhatsApp
    const config = await getWhatsAppConfigById(supportSession.configId)
    if (!config) {
      return NextResponse.json({ success: false, error: "Configuración no encontrada" }, { status: 404 })
    }

    // Enviar mensaje vía WhatsApp
    await sendWhatsAppMessage(config.phoneNumberId, config.accessToken, supportSession.phoneNumber, message.trim())

    // Guardar mensaje en historial de soporte
    const supportMessage: HumanSupportMessage = {
      id: nanoid(),
      sessionId,
      role: "agent",
      content: message.trim(),
      timestamp: new Date().toISOString(),
      agentId: session.userId,
    }

    await saveSupportMessage(supportMessage)

    return NextResponse.json({
      success: true,
      message: "Mensaje enviado correctamente",
    })
  } catch (error: any) {
    console.error("[API] Error enviando mensaje:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
