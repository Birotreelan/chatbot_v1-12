import { getWhatsAppConfig } from "@/lib/db"
import { EmbeddableWidget } from "@/components/chat/embeddable-widget"
import { notFound } from "next/navigation"

export default async function ChatDemoPage({ params }: { params: { configId: string } }) {
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
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Chat Demo: {config.displayName}</h1>

        <div className="bg-white p-6 rounded-lg shadow-md mb-8">
          <h2 className="text-xl font-semibold mb-4">Instrucciones para embeber</h2>
          <p className="mb-4">Para incluir este chat en tu sitio web, copia el siguiente código:</p>

          <div className="bg-gray-100 p-4 rounded-md overflow-x-auto">
            <pre className="text-sm">
              {`<iframe 
  src="${process.env.APP_URL || process.env.VERCEL_URL || "https://your-domain.com"}/widget/${config.id}" 
  width="100%" 
  height="600px" 
  frameBorder="0"
></iframe>`}
            </pre>
          </div>

          <p className="mt-4 text-sm text-gray-600">
            Puedes ajustar el ancho y alto según tus necesidades. El widget se adaptará automáticamente.
          </p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4">Vista previa</h2>
          <p className="mb-4">Así se verá el chat en tu sitio web:</p>

          <div className="border rounded-lg h-[500px] relative">
            <EmbeddableWidget configId={params.configId} {...widgetConfig} />
          </div>
        </div>
      </div>
    </div>
  )
}
