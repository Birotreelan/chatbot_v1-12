import { type NextRequest, NextResponse } from "next/server"
import { getWhatsAppConfig, getConfigByClienteId } from "@/lib/db"

export async function GET(request: NextRequest) {
  try {
    console.log("[WIDGET API] === INICIO DE SOLICITUD ===")
    console.log("[WIDGET API] URL completa:", request.url)
    console.log("[WIDGET API] Headers:", Object.fromEntries(request.headers.entries()))

    // Obtener cliente_id del query string
    const clienteId = request.nextUrl.searchParams.get("cliente_id")
    const configOnly = request.nextUrl.searchParams.get("config_only") === "true"

    console.log("[WIDGET API] Parámetros recibidos:")
    console.log("[WIDGET API] - cliente_id:", clienteId)
    console.log("[WIDGET API] - config_only:", configOnly)
    console.log("[WIDGET API] - Todos los searchParams:", Object.fromEntries(request.nextUrl.searchParams.entries()))

    if (!clienteId) {
      console.log("[WIDGET API] ❌ ERROR: cliente_id es requerido")
      return NextResponse.json({ error: "cliente_id es requerido" }, { status: 400 })
    }

    console.log("[WIDGET API] 🔍 Buscando configuración para cliente_id:", clienteId)

    // Intentar obtener configuración por cliente_id primero
    let config = await getConfigByClienteId(clienteId)
    console.log("[WIDGET API] Resultado de getConfigByClienteId:", config ? "ENCONTRADA" : "NO ENCONTRADA")

    // Si no se encuentra por cliente_id, intentar por ID directo
    if (!config) {
      console.log("[WIDGET API] 🔍 Intentando buscar por ID directo:", clienteId)
      config = await getWhatsAppConfig(clienteId)
      console.log("[WIDGET API] Resultado de getWhatsAppConfig:", config ? "ENCONTRADA" : "NO ENCONTRADA")
    }

    if (!config) {
      console.log("[WIDGET API] ❌ ERROR: Configuración no encontrada para:", clienteId)

      // Agregar logs adicionales para debug
      console.log("[WIDGET API] 🔍 Intentando listar todas las configuraciones disponibles...")
      try {
        const { getAllWhatsAppConfigs } = await import("@/lib/db")
        const allConfigs = await getAllWhatsAppConfigs()
        console.log("[WIDGET API] Total de configuraciones encontradas:", allConfigs.length)
        console.log(
          "[WIDGET API] IDs disponibles:",
          allConfigs.map((c) => ({ id: c.id, cliente_id: c.cliente_id, displayName: c.displayName })),
        )
      } catch (listError) {
        console.error("[WIDGET API] Error al listar configuraciones:", listError)
      }

      return NextResponse.json({ error: "Configuración no encontrada" }, { status: 404 })
    }

    console.log("[WIDGET API] ✅ Configuración encontrada:")
    console.log("[WIDGET API] - ID:", config.id)
    console.log("[WIDGET API] - cliente_id:", config.cliente_id)
    console.log("[WIDGET API] - displayName:", config.displayName)
    console.log("[WIDGET API] - widgetEnabled:", config.widgetEnabled)

    if (!config.widgetEnabled) {
      console.log("[WIDGET API] ❌ ERROR: Widget deshabilitado para:", config.displayName)
      return NextResponse.json({ error: "Widget deshabilitado" }, { status: 403 })
    }

    // Si solo se solicita la configuración, devolver JSON
    if (configOnly) {
      console.log("[WIDGET API] 📋 Devolviendo solo configuración")
      const configResponse = {
        widgetAssistantId: config.widgetAssistantId || "dummy_widget_assistant_id",
        widgetTitle: config.widgetTitle || "Asistente Virtual",
        widgetSubtitle: config.widgetSubtitle || "Estamos para ayudarte",
        widgetWelcomeMessage: config.widgetWelcomeMessage || "¡Hola! ¿En qué puedo ayudarte hoy?",
        widgetPlaceholder: config.widgetPlaceholder || "Escribe tu mensaje...",
        widgetPrimaryColor: config.widgetPrimaryColor || "#0ea5e9",
        widgetSecondaryColor: config.widgetSecondaryColor || "#f3f4f6",
        widgetPosition: config.widgetPosition || "bottom-right",
        widgetTheme: config.widgetTheme || "light",
        widgetMaxWidth: config.widgetMaxWidth || 380,
        widgetMaxHeight: config.widgetMaxHeight || 600,
        widgetBorderRadius: config.widgetBorderRadius || 12,
        widgetShadow: config.widgetShadow !== false,
        widgetAnimation: config.widgetAnimation !== false,
        widgetShowFloatingText: config.widgetShowFloatingText !== false,
        widgetFloatingButtonText: config.widgetFloatingButtonText || "Obtené tu turno con nuestro asistente virtual",
      }
      console.log("[WIDGET API] Configuración a devolver:", configResponse)
      return NextResponse.json(configResponse)
    }

    // Redirigir a la página de chat con el parámetro embedded=true
    const chatUrl = `/chat/${config.id}?embedded=true`
    console.log("[WIDGET API] 🔄 Redirigiendo a:", chatUrl)

    // Devolver HTML que redirige a la página de chat
    return new NextResponse(
      `<!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta http-equiv="refresh" content="0;url=${chatUrl}">
          <title>Redireccionando...</title>
          <style>
            body {
              font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              background-color: #f9fafb;
            }
            .loader {
              border: 4px solid #f3f3f3;
              border-top: 4px solid #0ea5e9;
              border-radius: 50%;
              width: 40px;
              height: 40px;
              animation: spin 1s linear infinite;
              margin-right: 12px;
            }
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
            .container {
              display: flex;
              align-items: center;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="loader"></div>
            <p>Cargando chat...</p>
          </div>
          <script>
            console.log("[WIDGET REDIRECT] Redirigiendo a: ${chatUrl}");
            window.location.href = "${chatUrl}";
          </script>
        </body>
      </html>`,
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
        },
      },
    )
  } catch (error) {
    console.error("[WIDGET API] ❌ ERROR CRÍTICO:", error)
    console.error("[WIDGET API] Stack trace:", error instanceof Error ? error.stack : "No stack trace available")
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
