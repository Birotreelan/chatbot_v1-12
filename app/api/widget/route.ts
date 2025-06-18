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

    // Devolver toda la configuración necesaria
    return NextResponse.json({
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
      // Incluir todos los campos necesarios
      ...config,
    })
  } catch (error) {
    console.error("Error fetching widget configuration:", error)
    return NextResponse.json({ error: "Failed to fetch widget configuration" }, { status: 500 })
  }
}
