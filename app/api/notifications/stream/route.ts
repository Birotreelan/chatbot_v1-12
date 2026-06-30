import { validateSSOToken } from "@/lib/sso"
import { getPendingSessions, getAgentActiveSessions } from "@/lib/human-support"

/**
 * API de Server-Sent Events para notificaciones en tiempo real
 * Autenticación via token SSO en query param (no usa cookies)
 * 
 * GET /api/notifications/stream?sso_token=xxx
 * 
 * Envía eventos SSE cada 10 segundos con el estado actual:
 * data: {"pending_count":5,"active_count":2,"total":7,"timestamp":1234567890}
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const ssoToken = url.searchParams.get("sso_token")

  console.log("[Notifications Stream] Nueva conexión SSE")

  if (!ssoToken) {
    console.log("[Notifications Stream] Error: No hay sso_token")
    return new Response("Token SSO requerido", { status: 401 })
  }

  // Obtener IP y User-Agent para validación de fingerprint
  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() 
    || request.headers.get("x-real-ip") 
    || "unknown"
  const userAgent = request.headers.get("user-agent") || "unknown"

  // Validar token SSO
  const validation = await validateSSOToken(ssoToken, clientIp, userAgent)

  if (!validation.valid || !validation.payload || !validation.clientConfig) {
    console.log("[Notifications Stream] Token inválido:", validation.error)
    return new Response(validation.error || "Token SSO inválido", { status: 401 })
  }

  const { payload, clientConfig } = validation
  const tenantId = clientConfig.id
  const userId = payload.usuario_id 
    ? `sso_${payload.cliente_id}_${payload.usuario_id}`
    : `sso_${payload.cliente_id}`

  console.log("[Notifications Stream] Conexión autenticada - tenantId:", tenantId, "userId:", userId)

  // Crear stream SSE
  const encoder = new TextEncoder()
  let isConnectionClosed = false
  let intervalId: NodeJS.Timeout | null = null

  const stream = new ReadableStream({
    async start(controller) {
      // Función para obtener y enviar el estado actual
      const sendUpdate = async () => {
        if (isConnectionClosed) {
          if (intervalId) clearInterval(intervalId)
          return
        }

        try {
          // Obtener conteos actuales
          const pendingSessions = await getPendingSessions(tenantId)
          const activeSessions = await getAgentActiveSessions(userId)

          const data = {
            pending_count: pendingSessions.length,
            active_count: activeSessions.length,
            total: pendingSessions.length + activeSessions.length,
            timestamp: Date.now()
          }

          // Enviar evento SSE
          const message = `data: ${JSON.stringify(data)}\n\n`
          controller.enqueue(encoder.encode(message))

          console.log("[Notifications Stream] Enviado update - Pendientes:", data.pending_count, "Activas:", data.active_count)
        } catch (error) {
          console.error("[Notifications Stream] Error obteniendo datos:", error)
          // No cerrar la conexión por errores temporales
        }
      }

      // Enviar estado inicial inmediatamente
      await sendUpdate()

      // Configurar intervalo para updates (cada 30 segundos — reducido de 10s para ahorrar bandwidth)
      intervalId = setInterval(sendUpdate, 30000)

      // Manejar señal de abort (cliente desconectado)
      request.signal.addEventListener("abort", () => {
        console.log("[Notifications Stream] Cliente desconectado")
        isConnectionClosed = true
        if (intervalId) clearInterval(intervalId)
        controller.close()
      })
    },

    cancel() {
      console.log("[Notifications Stream] Stream cancelado")
      isConnectionClosed = true
      if (intervalId) clearInterval(intervalId)
    }
  })

  // Retornar response SSE
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "X-Accel-Buffering": "no", // Deshabilitar buffering en nginx/proxy
    },
  })
}

// Manejar CORS preflight
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  })
}
