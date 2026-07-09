import { NextResponse } from "next/server"
import { getConfigByClienteId } from "@/lib/db"

export async function GET(request: Request) {
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

    // SEGURIDAD (2026-07-06): devolver SOLO los campos que el widget necesita.
    // Antes se hacía `...config`, exponiendo accessToken de WhatsApp, proxy y
    // teléfono de escalación a cualquier visitante del sitio público.
    // Cache CDN de Vercel: s-maxage=300 → los hits repetidos se sirven desde el
    // CDN sin invocar la función ni tocar Redis.
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
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      },
    )
  } catch (error) {
    console.error("Error fetching widget configuration:", error)
    return NextResponse.json({ error: "Failed to fetch widget configuration" }, { status: 500 })
  }
}
