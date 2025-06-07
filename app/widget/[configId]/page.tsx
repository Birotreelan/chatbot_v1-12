import { getWhatsAppConfig } from "@/lib/db"
import { EmbeddableWidget } from "@/components/chat/embeddable-widget"
import { notFound } from "next/navigation"

export default async function WidgetPage({ params }: { params: { configId: string } }) {
  const config = await getWhatsAppConfig(params.configId)

  if (!config || !config.active) {
    return notFound()
  }

  // Obtener configuración del widget desde la configuración de WhatsApp
  const widgetConfig = {
    title: config.widgetTitle || config.displayName,
    primaryColor: config.widgetPrimaryColor || "#0ea5e9",
    secondaryColor: config.widgetSecondaryColor || "#f0f9ff",
    position: (config.widgetPosition || "bottom-right") as "bottom-right" | "bottom-left",
    welcomeMessage: config.widgetWelcomeMessage || "¡Hola! ¿En qué puedo ayudarte hoy?",
  }

  return (
    <html>
      <head>
        <title>Chat Widget</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{`
          body, html {
            margin: 0;
            padding: 0;
            height: 100%;
            overflow: hidden;
          }
        `}</style>
      </head>
      <body>
        <EmbeddableWidget configId={params.configId} {...widgetConfig} />
      </body>
    </html>
  )
}
