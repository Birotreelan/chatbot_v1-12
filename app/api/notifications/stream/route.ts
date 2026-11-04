import { validateSSOToken, buildSsoUserId, renovarTokenSSO } from "@/lib/sso"
import { conteoParaElWidget } from "@/lib/notificaciones-conteo"

/**
 * API de Server-Sent Events para notificaciones en tiempo real
 *
 * ── Reemplazado por /api/notifications/conteo (4/11/2026) ─────────────────
 *
 * El widget ya no se conecta acá: pide los conteos cada 30 segundos al
 * endpoint JSON. El motivo es de costo y está explicado en esa ruta — este
 * stream vive 240 s por conexión y el cliente reconecta, así que mantenía una
 * instancia de función viva todo el horario de atención de cada clínica, y en
 * Fluid compute la memoria se factura por tiempo de vida de la instancia.
 *
 * Se deja en pie a propósito: el loader del widget está embebido en el sistema
 * de las clínicas y puede quedar cacheado del lado de ellos. Una recepción con
 * la página vieja abierta sigue recibiendo notificaciones hasta que recargue,
 * y son las pantallas desde las que se atiende a los pacientes.
 *
 * Se puede borrar cuando los logs no muestren más conexiones acá.
 * Autenticación via token SSO en query param (no usa cookies)
 * 
 * GET /api/notifications/stream?sso_token=xxx
 * 
 * Envía eventos SSE cada 10 segundos con el estado actual:
 * data: {"pending_count":5,"active_count":2,"esperando_count":1,"total":6,"timestamp":1234567890}
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

  const { payload } = validation
  // IMPORTANTE: el tenantId de las sesiones de soporte es cliente_id, no clientConfig.id/configId
  // (createSupportSession() y el login de /support usan cliente_id). Ver misma nota en
  // /api/notifications/status/route.ts — este era el bug real de conteo del widget.
  const tenantId = payload.cliente_id
  const userId = buildSsoUserId(payload.cliente_id, payload.usuario_id)

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
          // La caché y el criterio del total viven en lib/notificaciones-conteo.ts,
          // compartidos con el endpoint JSON: dos copias significaban que los dos
          // badges podían contar distinto durante una ventana de caché.
          const conteo = await conteoParaElWidget(tenantId, userId)

          const data = {
            pending_count: conteo.pending_count,
            active_count: conteo.active_count,
            esperando_count: conteo.esperando_count,
            total: conteo.total,
            timestamp: Date.now()
          }

          // Enviar evento SSE
          const message = `data: ${JSON.stringify(data)}\n\n`
          controller.enqueue(encoder.encode(message))

          console.log("[Notifications Stream] Enviado update - Pendientes:", data.pending_count, "Activas:", data.active_count, "Esperando:", data.esperando_count)
        } catch (error) {
          console.error("[Notifications Stream] Error obteniendo datos:", error)
          // No cerrar la conexión por errores temporales
        }
      }

      // Enviar retry hint: el cliente reconectará en 3 s si el servidor cierra la conexión
      controller.enqueue(encoder.encode(`retry: 3000\n\n`))

      // ── Renovación deslizante del token (17/9/2026) ────────────────────────
      //
      // Esta conexión se cierra sola a los 240 s y el cliente reconecta, así que
      // acá pasa un token nuevo cada 4 minutos mientras la pestaña esté abierta.
      // Mientras el widget siga en uso, la sesión no se cae aunque el sistema de
      // la clínica nunca renueve el token original.
      //
      // Antes, al vencer el token a las 24 h, el widget quedaba reconectando
      // cada 5 s contra un 401: 4.400 requests por hora y el usuario sin
      // notificaciones sin enterarse (caso del 17/9, usuario Pablo Deromedis).
      //
      // Se manda como evento con nombre propio para que un cliente viejo, que
      // sólo escucha `onmessage`, lo ignore sin romperse.
      const tokenRenovado = renovarTokenSSO(payload)
      if (tokenRenovado) {
        controller.enqueue(
          encoder.encode(`event: token_renovado\ndata: ${JSON.stringify({ sso_token: tokenRenovado })}\n\n`),
        )
        console.log("[Notifications Stream] Token renovado enviado al cliente")
      }

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
