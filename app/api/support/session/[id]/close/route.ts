import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getSupportSession, closeSession } from "@/lib/human-support"
import { getWhatsAppConfigById } from "@/lib/db"
import { sendWhatsAppMessage } from "@/lib/whatsapp-api"

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireAuth()
    const sessionId = params.id
    const body = await request.json()
    const { note } = body || {}

    const supportSession = await getSupportSession(sessionId)

    if (!supportSession) {
      return NextResponse.json({ success: false, error: "Sesión no encontrada" }, { status: 404 })
    }

    // Verificar permisos
    if (session.role === "support_agent") {
      // El agente solo puede cerrar sus propias sesiones
      if (supportSession.assignedTo !== session.userId) {
        return NextResponse.json({ success: false, error: "No estás asignado a esta sesión" }, { status: 403 })
      }
    } else if (session.role === "super_admin") {
      // Super admin puede cerrar cualquier sesión
    } else {
      return NextResponse.json({ success: false, error: "No autorizado" }, { status: 403 })
    }

    // Cerrar la sesión
    const closed = await closeSession(sessionId, note)

    if (!closed) {
      return NextResponse.json({ success: false, error: "No se pudo cerrar la sesión" }, { status: 500 })
    }

    // Enviar mensaje automático al usuario
    try {
      const config = await getWhatsAppConfigById(supportSession.configId)
      if (config) {
        const message = `Has sido reconectado con el asistente virtual. ¡Gracias por tu paciencia! 🤖`
        await sendWhatsAppMessage(config.phoneNumberId, config.accessToken, supportSession.phoneNumber, message)
      }
    } catch (error) {
      console.error("[API] Error enviando mensaje de cierre:", error)
      // No fallar si no se puede enviar el mensaje
    }

    return NextResponse.json({
      success: true,
      message: "Sesión cerrada correctamente",
    })
  } catch (error: any) {
    console.error("[API] Error cerrando sesión:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
