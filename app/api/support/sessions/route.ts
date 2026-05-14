import { NextResponse } from "next/server"
import { getSessionForApi, getSessionFromRequest } from "@/lib/auth"
import { getPendingSessions, getAgentActiveSessions, getActiveSessionsByTenant } from "@/lib/human-support"

export async function GET(request: Request) {
  try {
    // Intentar obtener sesión de múltiples formas (cookie, header, query param)
    // para soportar Safari donde las cookies no funcionan en iframes
    const session = await getSessionFromRequest(request)
    
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

    // Obtener sesiones activas
    let activeSessions: any[] = []
    if (session.role === "support_agent") {
      // Primero intentar obtener las sesiones activas del agente específico
      activeSessions = await getAgentActiveSessions(session.userId)
      console.log("[API Sessions] Sesiones activas del agente (por userId):", activeSessions.length)
      
      // Si no hay sesiones activas por userId (típico en SSO donde el userId cambia),
      // buscar todas las sesiones activas del tenant
      if (activeSessions.length === 0 && session.tenantId) {
        console.log("[API Sessions] Buscando sesiones activas por tenantId (fallback para SSO)")
        activeSessions = await getActiveSessionsByTenant(session.tenantId)
        console.log("[API Sessions] Sesiones activas del tenant:", activeSessions.length)
      }
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
