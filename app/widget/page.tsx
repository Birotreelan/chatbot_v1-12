import { Suspense } from "react"
import { getWhatsappConfigByClienteId } from "@/lib/db"
import WidgetChat from "@/components/chat/widget-chat"

interface WidgetPageProps {
  searchParams: {
    clienteId?: string
    position?: string
    embedded?: string
  }
}

async function WidgetContent({ searchParams }: WidgetPageProps) {
  console.log("[WIDGET-PAGE] 🎨 Renderizando página del widget")
  console.log("[WIDGET-PAGE] 📋 Search params:", searchParams)

  const { clienteId, position = "bottom-right", embedded = "false" } = searchParams

  if (!clienteId) {
    console.error("[WIDGET-PAGE] ❌ Cliente ID faltante")
    return (
      <div className="flex items-center justify-center min-h-screen bg-red-50">
        <div className="text-center p-6 bg-white rounded-lg shadow-lg">
          <h1 className="text-xl font-bold text-red-600 mb-2">Error de Configuración</h1>
          <p className="text-gray-600">Cliente ID requerido</p>
        </div>
      </div>
    )
  }

  // Obtener configuración del cliente
  let config = null
  try {
    config = await getWhatsappConfigByClienteId(clienteId)
    console.log("[WIDGET-PAGE] ✅ Configuración obtenida:", config?.displayName || "No encontrada")
  } catch (error) {
    console.error("[WIDGET-PAGE] ❌ Error obteniendo configuración:", error)
  }

  // Configuración por defecto si no se encuentra
  const defaultConfig = {
    widgetTitle: "Asistente Virtual",
    widgetSubtitle: "Estamos aquí para ayudarte",
    widgetWelcomeMessage: "¡Hola! ¿En qué puedo ayudarte hoy?",
    widgetPlaceholder: "Escribe tu mensaje...",
    widgetPrimaryColor: "#0ea5e9",
    widgetSecondaryColor: "#f0f9ff",
  }

  const finalConfig = config
    ? {
        ...defaultConfig,
        widgetTitle: config.widgetTitle || defaultConfig.widgetTitle,
        widgetSubtitle: config.widgetSubtitle || defaultConfig.widgetSubtitle,
        widgetWelcomeMessage: config.widgetWelcomeMessage || defaultConfig.widgetWelcomeMessage,
        widgetPlaceholder: config.widgetPlaceholder || defaultConfig.widgetPlaceholder,
        widgetPrimaryColor: config.widgetPrimaryColor || defaultConfig.widgetPrimaryColor,
        widgetSecondaryColor: config.widgetSecondaryColor || defaultConfig.widgetSecondaryColor,
      }
    : defaultConfig

  console.log("[WIDGET-PAGE] 🎨 Configuración final:", finalConfig)

  return <WidgetChat clienteId={clienteId} config={finalConfig} position={position} embedded={embedded === "true"} />
}

export default function WidgetPage(props: WidgetPageProps) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      }
    >
      <WidgetContent {...props} />
    </Suspense>
  )
}
