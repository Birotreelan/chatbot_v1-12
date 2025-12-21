import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getPendingSessions, getAgentActiveSessions } from "@/lib/human-support"

export async function GET(request: Request) {
  try {
    const session = await requireAuth()

    // Obtener sesiones pendientes filtradas por tenant
    const pendingSessions = await getPendingSessions(session.tenantId)

    // Si es agente de soporte, también obtener sus sesiones activas
    let activeSessions = []
    if (session.role === "support_agent") {
      activeSessions = await getAgentActiveSessions(session.userId)
    }

    const allSessions = [...pendingSessions, ...activeSessions]

    return NextResponse.json({
      success: true,
      sessions: allSessions, // Cambiar estructura para que coincida con el frontend
      pending: pendingSessions,
      active: activeSessions,
    })
  } catch (error: any) {
    console.error("[API] Error obteniendo sesiones:", error)
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        sessions: [], // Retornar array vacío en caso de error
      },
      { status: 500 },
    )
  }
}
