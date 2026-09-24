import { NextResponse } from "next/server"
import { getConfigByClienteId } from "@/lib/db"
import { rateLimit } from "@/lib/rate-limit"
import { isWidgetOriginAllowed } from "@/lib/widget-domain-validation"

// ── Ahora sí valida el origen (24/9/2026) ──────────────────────────────────
//
// Hasta hoy no lo hacía, y la nota que estaba acá daba dos razones. Una sigue
// siendo cierta y la otra no alcanzaba:
//
//  - "No expone PII": correcto, sólo devuelve datos de apariencia. Pero el
//    punto no es lo que se filtra: es que este endpoint es lo que necesita el
//    loader para MOSTRAR el widget. Sin él no hay botón ni burbuja, así que es
//    la puerta que hay que cerrar para que un sitio ajeno no pueda montar el
//    widget de una clínica con su cliente_id.
//
//  - "El cache no varía por Origin": esa era la objeción real, y era buena.
//    Validar sin más habría hecho que el CDN sirviera la respuesta cacheada de
//    un origen a otro, y el chequeo no habría servido para nada. Se resuelve
//    con `Vary: Origin` — el CDN guarda una entrada por origen— y con
//    `no-store` en los rechazos, para que un 403 no quede cacheado y termine
//    negándole el widget al sitio legítimo.
export async function GET(request: Request) {
  const ip = request.headers.get("x-forwarded-for") || "unknown"
  const rateLimitResult = await rateLimit(`widget-config:ip:${ip}`, 60, 60000)
  if (!rateLimitResult.success) {
    return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const cliente_id = searchParams.get("cliente_id")

  console.log("[WIDGET-API] Solicitud recibida con parámetros:", {
    cliente_id: searchParams.get("cliente_id"),
    url: request.url,
  })

  if (!cliente_id) {
    return NextResponse.json({ error: "Missing cliente_id parameter" }, { status: 400 })
  }

  try {
    // Usar la función correcta de la base de datos
    const config = await getConfigByClienteId(cliente_id)

    console.log("[WIDGET-API] Configuración encontrada:", {
      id: config?.id,
      displayName: config?.displayName,
      widgetEnabled: config?.widgetEnabled,
      widgetTitle: config?.widgetTitle,
      widgetSubtitle: config?.widgetSubtitle,
      widgetFloatingButtonText: config?.widgetFloatingButtonText,
    })

    if (!config) {
      return NextResponse.json({ error: "Widget configuration not found" }, { status: 404 })
    }

    if (!isWidgetOriginAllowed(config, request)) {
      console.warn(
        `[WIDGET-API] ⛔ Origen no autorizado para ${cliente_id}:`,
        request.headers.get("origin") || request.headers.get("referer") || "(sin origin ni referer)",
      )
      return NextResponse.json(
        { error: "Este sitio no está autorizado para mostrar el widget" },
        {
          status: 403,
          // Sin cache: un 403 cacheado le negaría el widget al sitio legítimo
          // durante los cinco minutos siguientes.
          headers: { "Cache-Control": "no-store", Vary: "Origin" },
        },
      )
    }

    // SEGURIDAD (2026-07-06): devolver SOLO los campos que el widget necesita.
    // Antes se hacía `...config`, exponiendo accessToken de WhatsApp, proxy y
    // teléfono de escalación a cualquier visitante del sitio público.
    // Cache CDN de Vercel: s-maxage=300 → los hits repetidos se sirven desde el
    // CDN sin invocar la función ni tocar Redis.
    // `whatsappNumber` se suma acá (9/7/2026) para el widget flotante de WhatsApp
    // (public/whatsapp-widget-loader.js) — no es un dato sensible, es el mismo
    // número al que ya escriben los pacientes.
    return NextResponse.json(
      {
        id: config.id,
        displayName: config.displayName,
        widgetEnabled: config.widgetEnabled,
        widgetTitle: config.widgetTitle,
        widgetSubtitle: config.widgetSubtitle,
        widgetWelcomeMessage: config.widgetWelcomeMessage,
        widgetPlaceholder: config.widgetPlaceholder,
        widgetFloatingButtonText: config.widgetFloatingButtonText,
        widgetPrimaryColor: config.widgetPrimaryColor,
        widgetSecondaryColor: config.widgetSecondaryColor,
        whatsappNumber: config.whatsappNumber || "",
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
          // Una entrada de cache por origen. Sin esto, el CDN le serviría a un
          // sitio la respuesta que generó para otro, y el chequeo de arriba no
          // serviría para nada.
          Vary: "Origin",
        },
      },
    )
  } catch (error) {
    console.error("Error fetching widget configuration:", error)
    return NextResponse.json({ error: "Failed to fetch widget configuration" }, { status: 500 })
  }
}
