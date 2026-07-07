import { validateSSOToken } from "@/lib/sso"
import { getPendingSessions, getAgentActiveSessions } from "@/lib/human-support"
import { getRedisClient } from "@/lib/redis"

// Cache TTL para los conteos SSE (segundos).
// Las reconexiones SSE son frecuentes (cada cierre/apertura de pestaña); con este cache
// no se re-lee Redis si los conteos ya se calcularon en los últimos 20 segundos.
const SSE_COUNTS_CACHE_TTL = 20
const SSE_COUNTS_CACHE_PREFIX = "sse_counts:"

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
  let lifetimeTimeoutId: NodeJS.Timeout | null = null

  // Vercel mata funciones serverless a los 300 s. Cerramos voluntariamente a los 240 s
  // para que el cliente EventSource reciba un cierre limpio y reconecte sin "error".
  const MAX_LIFETIME_MS = 240_000

  const stream = new ReadableStream({
    async start(controller) {
      // Función para obtener y enviar el estado actual
      const sendUpdate = async () => {
        if (isConnectionClosed) {
          if (intervalId) clearInterval(intervalId)
          return
        }

        try {
          const redis = getRedisClient()
          const cacheKey = `${SSE_COUNTS_CACHE_PREFIX}${tenantId}`

          let pending_count: number
          let active_count: number

          // Intentar servir desde cache Redis (evita re-leer sesiones en reconexiones frecuentes)
          const cached = redis ? await redis.get(cacheKey).catch(() => null) : null
          if (cached) {
            const counts = typeof cached === "string" ? JSON.parse(cached) : cached
            pending_count = counts.pending_count ?? 0
            active_count = counts.active_count ?? 0
          } else {
            // Cache miss → leer sesiones y guardar resultado
            const [pendingSessions, activeSessions] = await Promise.all([
              getPendingSessions(tenantId),
              getAgentActiveSessions(userId),
            ])
            pending_count = pendingSessions.length
            active_count = activeSessions.length
            if (redis) {
              redis.setex(cacheKey, SSE_COUNTS_CACHE_TTL, JSON.stringify({ pending_count, active_count })).catch(() => {})
            }
          }

          const data = {
            pending_count,
            active_count,
            total: pending_count + active_count,
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

      // Enviar retry hint: el cliente reconectará en 3 s si el servidor cierra la conexión
      controller.enqueue(encoder.encode(`retry: 3000\n\n`))

      // Enviar estado inicial inmediatamente
      await sendUpdate()

      // Configurar intervalo para updates (cada 30 segundos — reducido de 10s para ahorrar bandwidth)
      intervalId = setInterval(sendUpdate, 30000)

      // Cierre voluntario antes del timeout de Vercel (300 s)
      lifetimeTimeoutId = setTimeout(() => {
        if (!isConnectionClosed) {
          console.log("[Notifications Stream] Cerrando conexión por límite de vida (240 s) — el cliente reconectará")
          isConnectionClosed = true
          if (intervalId) clearInterval(intervalId)
          controller.close()
        }
      }, MAX_LIFETIME_MS)

      // Manejar señal de abort (cliente desconectado)
      request.signal.addEventListener("abort", () => {
        console.log("[Notifications Stream] Cliente desconectado")
        isConnectionClosed = true
        if (intervalId) clearInterval(intervalId)
        if (lifetimeTimeoutId) clearTimeout(lifetimeTimeoutId)
        controller.close()
      })
    },

    cancel() {
      console.log("[Notifications Stream] Stream cancelado")
      isConnectionClosed = true
      if (intervalId) clearInterval(intervalId)
      if (lifetimeTimeoutId) clearTimeout(lifetimeTimeoutId)
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
