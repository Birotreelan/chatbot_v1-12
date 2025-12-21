import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getSupportSession, getSupportMessages } from "@/lib/human-support"
import { getConversationMessages } from "@/lib/conversations"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth()
    const { id: sessionId } = await params

    const supportSession = await getSupportSession(sessionId)

    if (!supportSession) {
      return NextResponse.json({ success: false, error: "Sesión no encontrada" }, { status: 404 })
    }

    // Verificar permisos: super admin ve todo, agente solo su tenant
    if (session.role === "support_agent" && supportSession.tenantId !== session.tenantId) {
      return NextResponse.json({ success: false, error: "No autorizado" }, { status: 403 })
    }

    // Obtener historial completo de la conversación (incluye mensajes de IA)
    const conversationHistory = await getConversationMessages(supportSession.configId, supportSession.phoneNumber)

    // Obtener mensajes de la sesión de soporte (solo mensajes del agente)
    const supportMessages = await getSupportMessages(sessionId)

    return NextResponse.json({
      success: true,
      session: supportSession,
      conversationHistory,
      supportMessages,
    })
  } catch (error: any) {
    console.error("[API] Error obteniendo sesión:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
