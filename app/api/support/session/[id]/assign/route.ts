import { NextResponse } from "next/server"
import { requireSupportAgent } from "@/lib/auth"
import { assignSessionToAgent, getSupportSession } from "@/lib/human-support"
import { getWhatsAppConfigById } from "@/lib/db"
import { sendWhatsAppMessage } from "@/lib/whatsapp-api"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  console.log("[v0] [API ASSIGN] Iniciando asignación de sesión")

  try {
    console.log("[v0] [API ASSIGN] Verificando autenticación...")
    const session = await requireSupportAgent()
    console.log("[v0] [API ASSIGN] Usuario autenticado:", { userId: session.userId, tenantId: session.tenantId })

    console.log("[v0] [API ASSIGN] Obteniendo params...")
    const { id: sessionId } = await params
    console.log("[v0] [API ASSIGN] Session ID:", sessionId)

    console.log("[v0] [API ASSIGN] Buscando sesión de soporte...")
    const supportSession = await getSupportSession(sessionId)
    console.log("[v0] [API ASSIGN] Sesión encontrada:", supportSession ? "SI" : "NO")

    if (!supportSession) {
      console.log("[v0] [API ASSIGN] ERROR: Sesión no encontrada")
      return NextResponse.json({ success: false, error: "Sesión no encontrada" }, { status: 404 })
    }

    console.log("[v0] [API ASSIGN] Datos de la sesión:", {
      id: supportSession.id,
      status: supportSession.status,
      tenantId: supportSession.tenantId,
      phoneNumber: supportSession.phoneNumber,
    })

    // Verificar que el agente pertenece al mismo tenant
    console.log("[v0] [API ASSIGN] Verificando tenant match:", {
      sessionTenant: supportSession.tenantId,
      agentTenant: session.tenantId,
      match: supportSession.tenantId === session.tenantId,
    })

    if (supportSession.tenantId !== session.tenantId) {
      console.log("[v0] [API ASSIGN] ERROR: Tenant no coincide")
      return NextResponse.json({ success: false, error: "No autorizado para esta sesión" }, { status: 403 })
    }

    // Verificar que la sesión está pendiente
    console.log("[v0] [API ASSIGN] Verificando status:", supportSession.status)
    if (supportSession.status !== "pending") {
      console.log("[v0] [API ASSIGN] ERROR: Sesión no está en estado pending")
      return NextResponse.json({ success: false, error: "Sesión no disponible para asignar" }, { status: 400 })
    }

    // Asignar sesión al agente
    console.log("[v0] [API ASSIGN] Asignando sesión al agente...")
    const assigned = await assignSessionToAgent(sessionId, session.userId)
    console.log("[v0] [API ASSIGN] Resultado de asignación:", assigned)

    if (!assigned) {
      console.log("[v0] [API ASSIGN] ERROR: No se pudo asignar la sesión")
      return NextResponse.json({ success: false, error: "No se pudo asignar la sesión" }, { status: 500 })
    }

    // Enviar mensaje automático al usuario
    try {
      console.log("[v0] [API ASSIGN] Enviando mensaje de confirmación a WhatsApp...")
      const config = await getWhatsAppConfigById(supportSession.configId)
      console.log("[v0] [API ASSIGN] Config encontrada:", config ? "SI" : "NO")

      if (config) {
        const message = `Un agente está ahora contigo y te ayudará en breve. 👋`
        await sendWhatsAppMessage(config.phoneNumberId, config.accessToken, supportSession.phoneNumber, message)
        console.log("[v0] [API ASSIGN] Mensaje de confirmación enviado")
      }
    } catch (error) {
      console.error("[v0] [API ASSIGN] Error enviando mensaje de asignación:", error)
      // No fallar si no se puede enviar el mensaje
    }

    console.log("[v0] [API ASSIGN] ✅ Asignación completada exitosamente")
    return NextResponse.json({
      success: true,
      message: "Sesión asignada correctamente",
    })
  } catch (error: any) {
    console.error("[v0] [API ASSIGN] ❌ ERROR GENERAL:", error)
    console.error("[v0] [API ASSIGN] Stack trace:", error.stack)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
