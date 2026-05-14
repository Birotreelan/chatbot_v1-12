import { NextResponse } from "next/server"
import { getSessionForApi } from "@/lib/auth"
import { getPendingSessions, getAgentActiveSessions } from "@/lib/human-support"

export async function GET(request: Request) {
  try {
    const session = await getSessionForApi()
    
    console.log("[API Sessions] Sesión obtenida:", session ? {
      userId: session.userId,
      tenantId: session.tenantId,
      role: session.role,
      displayName: session.displayName
    } : "NO HAY SESIÓN")
    
    if (!session) {
      return NextResponse.json(
        { success: false, error: "No autenticado", sessions: [] },
        { status: 401 }
      )
    }

    // Obtener sesiones pendientes filtradas por tenant
    console.log("[API Sessions] Buscando sesiones pendientes para tenantId:", session.tenantId)
    const pendingSessions = await getPendingSessions(session.tenantId)
    console.log("[API Sessions] Sesiones pendientes encontradas:", pendingSessions.length)

    // Si es agente de soporte, también obtener sus sesiones activas
    let activeSessions: any[] = []
    if (session.role === "support_agent") {
      activeSessions = await getAgentActiveSessions(session.userId)
      console.log("[API Sessions] Sesiones activas del agente:", activeSessions.length)
    }

    const allSessions = [...pendingSessions, ...activeSessions]
    console.log("[API Sessions] Total de sesiones:", allSessions.length)

    return NextResponse.json({
      success: true,
      sessions: allSessions,
      pending: pendingSessions,
      active: activeSessions,
    })
  } catch (error: any) {
    console.error("[API Sessions] Error obteniendo sesiones:", error)
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        sessions: [],
      },
      { status: 500 },
    )
  }
}
