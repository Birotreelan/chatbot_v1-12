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
    console.log("[WIDGET-PAGE] ❌ Cliente ID no proporcionado")
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="text-center p-8 bg-white rounded-lg shadow-md">
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Error de Configuración</h2>
          <p className="text-gray-600">No se proporcionó un ID de cliente válido.</p>
        </div>
      </div>
    )
  }

  let config = null
  try {
    console.log("[WIDGET-PAGE] 🔍 Buscando configuración para cliente:", clienteId)
    config = await getWhatsappConfigByClienteId(clienteId)
    console.log("[WIDGET-PAGE] ✅ Configuración obtenida:", config ? "Encontrada" : "No encontrada")
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

  // Usar configuración encontrada o por defecto
  const widgetConfig = config
    ? {
        widgetTitle: config.widgetTitle || defaultConfig.widgetTitle,
        widgetSubtitle: config.widgetSubtitle || defaultConfig.widgetSubtitle,
        widgetWelcomeMessage: config.widgetWelcomeMessage || defaultConfig.widgetWelcomeMessage,
        widgetPlaceholder: config.widgetPlaceholder || defaultConfig.widgetPlaceholder,
        widgetPrimaryColor: config.widgetPrimaryColor || defaultConfig.widgetPrimaryColor,
        widgetSecondaryColor: config.widgetSecondaryColor || defaultConfig.widgetSecondaryColor,
      }
    : defaultConfig

  console.log("[WIDGET-PAGE] 🎨 Configuración final del widget:", widgetConfig)

  return (
    <WidgetChat
      clienteId={clienteId}
      position={position as "bottom-right" | "bottom-left" | "top-right" | "top-left"}
      embedded={embedded === "true"}
      config={widgetConfig}
    />
  )
}

export default function WidgetPage({ searchParams }: WidgetPageProps) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      }
    >
      <WidgetContent searchParams={searchParams} />
    </Suspense>
  )
}
