import { NextResponse } from "next/server"
import { v4 as uuidv4 } from "uuid"

// In-memory storage for widget configurations (replace with a database in a real application)
const widgetConfigs: { [id: string]: any } = {}

export async function POST(request: Request) {
  try {
    const body = await request.json()

    // Validate the request body (add more validation as needed)
    if (!body.displayName) {
      return new NextResponse("Display name is required", { status: 400 })
    }

    // Generate a unique ID for the widget
    const id = uuidv4()

    // Create a new widget configuration
    const config = {
      id,
      displayName: body.displayName,
      widgetEnabled: body.widgetEnabled || true,
      widgetTitle: body.widgetTitle || "Welcome!",
      widgetSubtitle: body.widgetSubtitle || "How can we help you?",
      widgetWelcomeMessage: body.widgetWelcomeMessage || "Hello there!",
      widgetPlaceholder: body.widgetPlaceholder || "Type your message...",
      widgetPrimaryColor: body.widgetPrimaryColor || "#007bff",
      widgetSecondaryColor: body.widgetSecondaryColor || "#ffffff",
      widgetPosition: body.widgetPosition || "bottom-right",
      widgetButtonText: body.widgetButtonText || "Chat with us",
      widgetHeaderText: body.widgetHeaderText || "Live Chat",
      widgetBrandingEnabled: body.widgetBrandingEnabled || true,
      widgetBrandingText: body.widgetBrandingText || "Powered by Your Brand",
      widgetMaxHeight: body.widgetMaxHeight || 400,
      widgetMaxWidth: body.widgetMaxWidth || 300,
      widgetBorderRadius: body.widgetBorderRadius || 8,
      widgetShadow: body.widgetShadow || true,
      widgetAnimation: body.widgetAnimation || "slide-in",
      widgetSoundEnabled: body.widgetSoundEnabled || false,
      widgetTheme: body.widgetTheme || "light",
      widgetFloatingButtonText: body.widgetFloatingButtonText || "?",
      widgetShowFloatingText: body.widgetShowFloatingText || true,
    }

    // Store the widget configuration
    widgetConfigs[id] = config

    // En la respuesta exitosa, asegurar que se incluyan todos los campos:
    return NextResponse.json({
      success: true,
      id: config.id,
      displayName: config.displayName,
      widgetEnabled: config.widgetEnabled,
      widgetTitle: config.widgetTitle,
      widgetSubtitle: config.widgetSubtitle,
      widgetWelcomeMessage: config.widgetWelcomeMessage,
      widgetPlaceholder: config.widgetPlaceholder,
      widgetPrimaryColor: config.widgetPrimaryColor,
      widgetSecondaryColor: config.widgetSecondaryColor,
      widgetPosition: config.widgetPosition,
      widgetButtonText: config.widgetButtonText,
      widgetHeaderText: config.widgetHeaderText,
      widgetBrandingEnabled: config.widgetBrandingEnabled,
      widgetBrandingText: config.widgetBrandingText,
      widgetMaxHeight: config.widgetMaxHeight,
      widgetMaxWidth: config.widgetMaxWidth,
      widgetBorderRadius: config.widgetBorderRadius,
      widgetShadow: config.widgetShadow,
      widgetAnimation: config.widgetAnimation,
      widgetSoundEnabled: config.widgetSoundEnabled,
      widgetTheme: config.widgetTheme,
      widgetFloatingButtonText: config.widgetFloatingButtonText,
      widgetShowFloatingText: config.widgetShowFloatingText,
    })
  } catch (error) {
    console.error("[WIDGET_POST]", error)
    return new NextResponse("Internal error", { status: 500 })
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get("id")

    if (!id) {
      return new NextResponse("Widget ID is required", { status: 400 })
    }

    const config = widgetConfigs[id]

    if (!config) {
      return new NextResponse("Widget not found", { status: 404 })
    }

    return NextResponse.json(config)
  } catch (error) {
    console.log("[WIDGET_GET]", error)
    return new NextResponse("Internal error", { status: 500 })
  }
}
