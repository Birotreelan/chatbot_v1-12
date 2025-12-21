import { NextResponse } from "next/server"
import { requireSupportAgent } from "@/lib/auth"
import { assignSessionToAgent, getSupportSession } from "@/lib/human-support"
import { getWhatsAppConfigById } from "@/lib/db"
import { sendWhatsAppMessage } from "@/lib/whatsapp-api"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSupportAgent()
    const { id: sessionId } = await params

    const supportSession = await getSupportSession(sessionId)

    if (!supportSession) {
      return NextResponse.json({ success: false, error: "Sesión no encontrada" }, { status: 404 })
    }

    // Verificar que el agente pertenece al mismo tenant
    if (supportSession.tenantId !== session.tenantId) {
      return NextResponse.json({ success: false, error: "No autorizado para esta sesión" }, { status: 403 })
    }

    // Verificar que la sesión está pendiente
    if (supportSession.status !== "pending") {
      return NextResponse.json({ success: false, error: "Sesión no disponible para asignar" }, { status: 400 })
    }

    // Asignar sesión al agente
    const assigned = await assignSessionToAgent(sessionId, session.userId)

    if (!assigned) {
      return NextResponse.json({ success: false, error: "No se pudo asignar la sesión" }, { status: 500 })
    }

    // Enviar mensaje automático al usuario
    try {
      const config = await getWhatsAppConfigById(supportSession.configId)
      if (config) {
        const message = `Un agente está ahora contigo y te ayudará en breve. 👋`
        await sendWhatsAppMessage(config.phoneNumberId, config.accessToken, supportSession.phoneNumber, message)
      }
    } catch (error) {
      console.error("[API] Error enviando mensaje de asignación:", error)
      // No fallar si no se puede enviar el mensaje
    }

    return NextResponse.json({
      success: true,
      message: "Sesión asignada correctamente",
    })
  } catch (error: any) {
    console.error("[API] Error asignando sesión:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
