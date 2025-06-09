import { type NextRequest, NextResponse } from "next/server"
import { getWhatsAppConfig } from "@/lib/db"

export async function GET(request: NextRequest) {
  try {
    // Obtener cliente_id del query string
    const clienteId = request.nextUrl.searchParams.get("cliente_id")

    if (!clienteId) {
      return NextResponse.json({ error: "cliente_id es requerido" }, { status: 400 })
    }

    // Verificar si solo se solicita la configuración
    const configOnly = request.nextUrl.searchParams.get("config_only") === "true"

    // Obtener configuración
    const config = await getWhatsAppConfig(clienteId)

    if (!config) {
      return NextResponse.json({ error: "Configuración no encontrada" }, { status: 404 })
    }

    if (!config.widgetEnabled) {
      return NextResponse.json({ error: "Widget deshabilitado" }, { status: 403 })
    }

    // Si solo se solicita la configuración, devolver JSON
    if (configOnly) {
      return NextResponse.json({
        widgetAssistantId: config.widgetAssistantId || "dummy_widget_assistant_id",
        widgetTitle: config.widgetTitle || "Asistente Virtual",
        widgetSubtitle: config.widgetSubtitle || "Estamos para ayudarte",
        widgetWelcomeMessage: config.widgetWelcomeMessage || "¡Hola! ¿En qué puedo ayudarte hoy?",
        widgetPlaceholder: config.widgetPlaceholder || "Escribe tu mensaje...",
        widgetPrimaryColor: config.widgetPrimaryColor || "#0ea5e9",
        widgetSecondaryColor: config.widgetSecondaryColor || "#f3f4f6",
        widgetPosition: config.widgetPosition || "bottom-right",
        widgetTheme: config.widgetTheme || "light",
      })
    }

    // Redirigir a la página de chat con el parámetro embedded=true
    const chatUrl = `/chat/${clienteId}?embedded=true`

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
    console.error("[WIDGET] Error:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
