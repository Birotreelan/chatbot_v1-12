import { NextResponse } from "next/server"
import { getSessionForApi, getSessionFromRequest } from "@/lib/auth"
import { getPendingSessions, getAgentActiveSessions } from "@/lib/human-support"
import { getWhatsAppConfigsByTenant } from "@/lib/db"
import { getClientFeatureFlags } from "@/lib/conversation-state/feature-flags"

export async function GET(request: Request) {
  try {
    // Intentar obtener sesión de múltiples formas (cookie, header, query param)
    // para soportar Safari donde las cookies no funcionan en iframes
    const session = await getSessionFromRequest(request)
    
    console.log("[API Sessions] Sesión obtenida:", session ? {
      userId: session.userId,
      tenantId: session.tenantId,
      role: session.role,
      displayName: session.displayName,
      ssoUsuarioId: session.ssoUsuarioId
    } : "NO HAY SESIÓN")
    
    if (!session) {
      return NextResponse.json(
        { success: false, error: "No autenticado", sessions: [] },
        { status: 401 }
      )
    }

    // Obtener sesiones pendientes filtradas por tenant (visibles para TODOS los usuarios del tenant)
    console.log("[API Sessions] Buscando sesiones pendientes para tenantId:", session.tenantId)
    const pendingSessions = await getPendingSessions(session.tenantId)
    console.log("[API Sessions] Sesiones pendientes encontradas:", pendingSessions.length)

    // Obtener sesiones activas SOLO del usuario actual (no de todo el tenant)
    // Esto es clave para el sistema multiusuario: cada usuario solo ve SUS conversaciones activas
    let activeSessions: any[] = []
    if (session.role === "support_agent") {
      // Obtener las sesiones activas asignadas a ESTE usuario específico
      activeSessions = await getAgentActiveSessions(session.userId)
      console.log("[API Sessions] Sesiones activas del agente (userId:", session.userId, "):", activeSessions.length)
    }

    const allSessions = [...pendingSessions, ...activeSessions]
    console.log("[API Sessions] Total de sesiones:", allSessions.length)

    // "Ofrecer al paciente" habilitado: true si ALGUNA config del tenant lo tiene activo.
    // Se usa para bloquear la vista de atención humana si la clínica no lo activó.
    let offerEnabled = false
    try {
      const configs = await getWhatsAppConfigsByTenant(session.tenantId)
      const flagsList = await Promise.all(configs.map((c) => getClientFeatureFlags(c.id)))
      offerEnabled = flagsList.some((f) => f.humanSupportOfferToPatient === true)
    } catch (e) {
      console.error("[API Sessions] Error calculando offerEnabled:", e)
    }

    return NextResponse.json({
      success: true,
      sessions: allSessions,
      pending: pendingSessions,
      active: activeSessions,
      offerEnabled,
      userInfo: {
        userId: session.userId,
        displayName: session.displayName,
        ssoUsuarioId: session.ssoUsuarioId
      }
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
