import { NextResponse } from "next/server"
import { validateSSOToken } from "@/lib/sso"
import { getPendingSessions, getAgentActiveSessions } from "@/lib/human-support"

/**
 * API de estado de notificaciones para el widget embebible
 * Autenticación via token SSO en query param (no usa cookies)
 * 
 * GET /api/notifications/status?sso_token=xxx
 * 
 * Response:
 * {
 *   success: true,
 *   pending_count: 5,      // Conversaciones pendientes (compartidas por tenant)
 *   active_count: 2,       // Conversaciones activas del usuario
 *   total: 7,
 *   user_info: { nombre: "Juan", apellido: "Pérez", usuario_id: "user_101" }
 * }
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const ssoToken = url.searchParams.get("sso_token")

    console.log("[Notifications Status API] Petición recibida")

    if (!ssoToken) {
      console.log("[Notifications Status API] Error: No hay sso_token")
      return NextResponse.json(
        { success: false, error: "Token SSO requerido" },
        { status: 401 }
      )
    }

    // Obtener IP y User-Agent para validación de fingerprint
    const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() 
      || request.headers.get("x-real-ip") 
      || "unknown"
    const userAgent = request.headers.get("user-agent") || "unknown"

    console.log("[Notifications Status API] Validando token SSO...")

    // Validar token SSO
    const validation = await validateSSOToken(ssoToken, clientIp, userAgent)

    if (!validation.valid || !validation.payload || !validation.clientConfig) {
      console.log("[Notifications Status API] Token inválido:", validation.error)
      return NextResponse.json(
        { 
          success: false, 
          error: validation.error || "Token SSO inválido",
          errorCode: validation.errorCode
        },
        { status: 401 }
      )
    }

    const { payload, clientConfig } = validation
    const tenantId = clientConfig.id // configId usado como tenantId
    
    // Construir userId único global (mismo formato que /api/auth/sso)
    const userId = payload.usuario_id 
      ? `sso_${payload.cliente_id}_${payload.usuario_id}`
      : `sso_${payload.cliente_id}`

    console.log("[Notifications Status API] Token válido - tenantId:", tenantId, "userId:", userId)

    // Obtener conteo de sesiones pendientes (compartidas por tenant)
    const pendingSessions = await getPendingSessions(tenantId)
    const pendingCount = pendingSessions.length

    // Obtener conteo de sesiones activas del usuario
    const activeSessions = await getAgentActiveSessions(userId)
    const activeCount = activeSessions.length

    // Contar mensajes no leídos en sesiones activas (opcional - para futuro)
    // Por ahora solo contamos sesiones, no mensajes individuales

    console.log("[Notifications Status API] Conteos - Pendientes:", pendingCount, "Activas:", activeCount)

    return NextResponse.json({
      success: true,
      pending_count: pendingCount,
      active_count: activeCount,
      total: pendingCount + activeCount,
      user_info: {
        nombre: payload.nombre || "",
        apellido: payload.apellido || "",
        usuario_id: payload.usuario_id || "",
        cliente_id: payload.cliente_id
      },
      timestamp: Date.now()
    })

  } catch (error: any) {
    console.error("[Notifications Status API] Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Error interno" },
      { status: 500 }
    )
  }
}

// Manejar CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  })
}
