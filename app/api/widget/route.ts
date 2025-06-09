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

    // Para el widget real, necesitamos renderizar HTML con el componente WidgetChat
    const headersList = headers()
    const host = headersList.get("host") || ""
    const protocol = host.includes("localhost") ? "http" : "https"

    // HTML para renderizar el widget directamente
    const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Chat Widget</title>
      <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
      <style>
        body, html {
          margin: 0;
          padding: 0;
          height: 100%;
          overflow: hidden;
        }
        #widget-container {
          height: 100vh;
          width: 100%;
        }
      </style>
    </head>
    <body>
      <div id="widget-container"></div>
      <script type="module">
        // Importar React y ReactDOM desde CDN
        import React from 'https://esm.sh/react@18.2.0';
        import ReactDOM from 'https://esm.sh/react-dom@18.2.0';
        import { createRoot } from 'https://esm.sh/react-dom@18.2.0/client';
        
        // Función para cargar el widget
        async function loadWidget() {
          try {
            // Redireccionar a la página de chat con el cliente ID
            window.location.href = "${protocol}://${host}/chat/${config.id}?embedded=true";
          } catch (error) {
            console.error("Error loading widget:", error);
            document.getElementById('widget-container').innerHTML = 
              '<div class="p-4 text-center text-red-500">Error cargando el widget. Por favor, intente nuevamente.</div>';
          }
        }
        
        // Cargar el widget
        loadWidget();
      </script>
    </body>
    </html>
    `

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html",
      },
    })
  } catch (error) {
    console.error("[WIDGET API] Error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
