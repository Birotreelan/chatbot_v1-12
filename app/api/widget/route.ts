import { NextResponse } from "next/server"
import { getConfigByClienteId } from "@/lib/db"
import { headers } from "next/headers"

export async function GET(request: Request) {
  try {
    // Parse URL and query parameters
    const url = new URL(request.url)
    const clienteId = url.searchParams.get("cliente_id")
    const configOnly = url.searchParams.get("config_only") === "true"

    if (!clienteId) {
      return NextResponse.json({ error: "Missing cliente_id parameter" }, { status: 400 })
    }

    // Get configuration for this client
    const config = await getConfigByClienteId(clienteId)

    if (!config) {
      return NextResponse.json({ error: "Configuration not found" }, { status: 404 })
    }

    // If config_only=true, just return the configuration
    if (configOnly) {
      return NextResponse.json({
        widgetAssistantId: config.widgetAssistantId,
        widgetTitle: config.widgetTitle,
        widgetPrimaryColor: config.widgetPrimaryColor,
        widgetSecondaryColor: config.widgetSecondaryColor,
        widgetWelcomeMessage: config.widgetWelcomeMessage,
        widgetPlaceholder: config.widgetPlaceholder,
        widgetButtonText: config.widgetButtonText,
        widgetHeaderText: config.widgetHeaderText,
        widgetSubtitle: config.widgetSubtitle,
        widgetBrandingEnabled: config.widgetBrandingEnabled,
        widgetBrandingText: config.widgetBrandingText,
        widgetTheme: config.widgetTheme,
        widgetAnimation: config.widgetAnimation,
        widgetSoundEnabled: config.widgetSoundEnabled,
        widgetPosition: config.widgetPosition,
        widgetMaxWidth: config.widgetMaxWidth,
        widgetMaxHeight: config.widgetMaxHeight,
        widgetBorderRadius: config.widgetBorderRadius,
        widgetShadow: config.widgetShadow,
        widgetShowFloatingText: config.widgetShowFloatingText,
        widgetFloatingButtonText: config.widgetFloatingButtonText,
      })
    }

    // Para el widget real, redirigir directamente a la página de chat
    const headersList = headers()
    const host = headersList.get("host") || ""
    const protocol = host.includes("localhost") ? "http" : "https"
    const redirectUrl = `${protocol}://${host}/chat/${config.id}?embedded=true`

    return NextResponse.redirect(redirectUrl)
  } catch (error) {
    console.error("[WIDGET API] Error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
