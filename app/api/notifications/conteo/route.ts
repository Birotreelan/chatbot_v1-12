/**
 * Los conteos del widget, en una sola respuesta (4/11/2026).
 *
 *   GET /api/notifications/conteo?sso_token=xxx
 *
 * ── Por qué existe, y qué reemplaza ────────────────────────────────────────
 *
 * El widget se conectaba a `/api/notifications/stream`, un SSE que vive 240
 * segundos y que el cliente reconecta solo. Mientras una recepción tenga su
 * sistema abierto, eso mantiene una instancia de función VIVA de forma
 * continua — y en Fluid compute la memoria se factura por tiempo de vida de la
 * instancia, no por CPU usada.
 *
 * El número: 731,9 GB-hora en el mes, que con el instance Standard de 2 GB son
 * 366 horas de instancia viva, o 12 horas por día. Eso no es tráfico de
 * pacientes: es el horario de atención de las clínicas.
 *
 * Y lo que lo volvía indefendible es que el SSE empujaba en un
 * `setInterval(..., 30000)`. O sea que se pagaban 366 horas de memoria para
 * entregar una latencia de 30 segundos — exactamente la que da una consulta
 * cada 30 segundos, que mantiene la instancia viva unos 100 ms por vez.
 *
 * Mismo dato, misma frescura, tres órdenes de magnitud menos de memoria.
 *
 * ── El token se renueva acá también ────────────────────────────────────────
 *
 * El SSE mandaba un token nuevo en cada conexión (cada 4 minutos), y eso es lo
 * que hace que la sesión no se caiga mientras la pestaña esté abierta, aunque
 * el sistema de la clínica nunca renueve el token original. Si el endpoint
 * nuevo no lo hiciera, el widget funcionaría perfecto hasta que el token
 * venciera a las 24 h y quedaría pidiendo contra un 401 — que es exactamente
 * el caso del 17/9/2026 que la renovación deslizante vino a arreglar.
 *
 * `renovarTokenSSO` es sólo criptografía, sin Redis, así que llamarlo en cada
 * consulta en vez de cada cuatro minutos no cuesta nada.
 */

import { NextResponse } from "next/server"
import { validateSSOToken, buildSsoUserId, renovarTokenSSO } from "@/lib/sso"
import { conteoParaElWidget } from "@/lib/notificaciones-conteo"

export const dynamic = "force-dynamic"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

export async function GET(request: Request) {
  const ssoToken = new URL(request.url).searchParams.get("sso_token")

  if (!ssoToken) {
    return NextResponse.json({ error: "Token SSO requerido" }, { status: 401, headers: CORS })
  }

  const clientIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  const userAgent = request.headers.get("user-agent") || "unknown"

  const validacion = await validateSSOToken(ssoToken, clientIp, userAgent)
  if (!validacion.valid || !validacion.payload || !validacion.clientConfig) {
    console.log("[NOTIF_CONTEO] Token inválido:", validacion.error)
    return NextResponse.json(
      { error: validacion.error || "Token SSO inválido" },
      { status: 401, headers: CORS },
    )
  }

  const { payload } = validacion
  // El tenantId de las sesiones de soporte es `cliente_id`, no `configId`:
  // createSupportSession y el login de /support usan cliente_id. Era el bug
  // real de conteo del widget — ver la misma nota en stream y status.
  const tenantId = payload.cliente_id
  const userId = buildSsoUserId(payload.cliente_id, payload.usuario_id)

  try {
    const conteo = await conteoParaElWidget(tenantId, userId)

    return NextResponse.json(
      {
        pending_count: conteo.pending_count,
        active_count: conteo.active_count,
        esperando_count: conteo.esperando_count,
        total: conteo.total,
        timestamp: Date.now(),
        // `null` si TREELAN_BOT_SECRET no está: el widget se queda con el que
        // tenía, que es lo que hacía con el SSE cuando no llegaba el evento.
        sso_token: renovarTokenSSO(payload),
      },
      {
        headers: {
          ...CORS,
          // Que ningún intermediario cachee esto: el conteo es por agente y la
          // caché que importa ya está del lado del servidor, con su TTL.
          "Cache-Control": "no-store",
        },
      },
    )
  } catch (error) {
    console.error("[NOTIF_CONTEO] Error obteniendo los conteos:", error)
    return NextResponse.json(
      { error: "No se pudieron obtener las notificaciones" },
      { status: 500, headers: CORS },
    )
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}
