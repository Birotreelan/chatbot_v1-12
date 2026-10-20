import { NextResponse } from "next/server"
import { validateSSOToken, buildSsoUserId } from "@/lib/sso"
import { contarAvisosDelAgente } from "@/lib/human-support"

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
 *   esperando_count: 1,    // De las activas, las que esperan que el agente conteste
 *   total: 6,              // pending_count + esperando_count (ver contarAvisosDelAgente)
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

    const { payload } = validation
    // IMPORTANTE: el tenantId de las sesiones de soporte es cliente_id (no clientConfig.id/configId).
    // createSupportSession() y el login de /support (app/api/auth/sso) usan cliente_id — si acá se
    // usa configId, getPendingSessions() nunca encuentra las sesiones recién creadas (bug real
    // reportado: el widget no contabiliza conversaciones derivadas).
    const tenantId = payload.cliente_id

    // Construir userId único global (mismo criterio que /api/auth/sso — ver buildSsoUserId)
    const userId = buildSsoUserId(payload.cliente_id, payload.usuario_id)

    console.log("[Notifications Status API] Token válido - tenantId:", tenantId, "userId:", userId)

    // El total lo decide lib/human-support (contarAvisosDelAgente), que es el
    // mismo cálculo que usa el stream SSE: si cada ruta armara el suyo, el
    // badge cambiaría de criterio en el primer tick.
    const conteo = await contarAvisosDelAgente(tenantId, userId)

    console.log(
      "[Notifications Status API] Conteos - Pendientes:", conteo.pending_count,
      "Activas:", conteo.active_count,
      "Esperando respuesta:", conteo.esperando_count,
    )

    return NextResponse.json({
      success: true,
      pending_count: conteo.pending_count,
      active_count: conteo.active_count,
      esperando_count: conteo.esperando_count,
      total: conteo.total,
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
