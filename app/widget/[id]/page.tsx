import { getConfigByClienteId, getConfigById } from "@/lib/db"
import WidgetChat from "@/components/chat/widget-chat"
import { notFound } from "next/navigation"

interface WidgetPageProps {
  params: { id: string }
  searchParams: { embedded?: string; clienteId?: string }
}

export default async function WidgetPage({ params, searchParams }: WidgetPageProps) {
  const { id } = params
  const { embedded, clienteId } = searchParams

  console.log("[WIDGET-PAGE] Parámetros recibidos:", {
    id,
    embedded,
    clienteId,
    searchParams,
  })

  let config = null

  try {
    // Primero intentar buscar por cliente_id si se proporciona en searchParams
    if (clienteId) {
      console.log("[WIDGET-PAGE] Buscando por clienteId:", clienteId)
      config = await getConfigByClienteId(clienteId)
    }

    // Si no se encuentra por clienteId, buscar por ID de configuración
    if (!config) {
      console.log("[WIDGET-PAGE] Buscando por ID de configuración:", id)
      config = await getConfigById(id)
    }

    // Si aún no se encuentra, intentar usar el ID como cliente_id
    if (!config) {
      console.log("[WIDGET-PAGE] Intentando usar ID como cliente_id:", id)
      config = await getConfigByClienteId(id)
    }
  } catch (error) {
    console.error("[WIDGET-PAGE] Error al buscar configuración:", error)
  }

  if (!config) {
    console.log("[WIDGET-PAGE] Configuración no encontrada para:", { id, clienteId })
    notFound()
  }

  if (!config.widgetEnabled) {
    console.log("[WIDGET-PAGE] Widget deshabilitado para configuración:", config.id)
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="text-center p-8">
          <h1 className="text-xl font-semibold text-gray-800 mb-2">Widget no disponible</h1>
          <p className="text-gray-600">Este widget de chat no está habilitado actualmente.</p>
        </div>
      </div>
    )
  }

  console.log("[WIDGET-PAGE] Configuración encontrada:", {
    id: config.id,
    displayName: config.displayName,
    widgetEnabled: config.widgetEnabled,
    clienteId: config.cliente_id,
  })

  // Usar cliente_id si está disponible, sino usar el ID de la configuración
  const finalClienteId = config.cliente_id || config.id

  const widgetConfig = {
    widgetTitle: config.widgetTitle || "Asistente Virtual",
    widgetSubtitle: config.widgetSubtitle || "Estamos aquí para ayudarte",
    widgetWelcomeMessage: config.widgetWelcomeMessage || "¡Hola! ¿En qué puedo ayudarte hoy?",
    widgetPlaceholder: config.widgetPlaceholder || "Escribe tu mensaje...",
    widgetPrimaryColor: config.widgetPrimaryColor || "#0ea5e9",
    widgetSecondaryColor: config.widgetSecondaryColor || "#f0f9ff",
  }

  // Si está embebido, mostrar solo el chat sin layout adicional
  if (embedded === "true") {
    return (
      <div className="h-screen w-full">
        <WidgetChat clienteId={finalClienteId} config={widgetConfig} hideHeader={false} />
      </div>
    )
  }

  // Si no está embebido, mostrar con layout completo
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div
        className="w-full max-w-md h-[600px] rounded-lg shadow-lg overflow-hidden"
        style={{
          maxWidth: `${config.widgetMaxWidth || 400}px`,
          height: `${config.widgetMaxHeight || 600}px`,
          borderRadius: `${config.widgetBorderRadius || 12}px`,
          boxShadow: config.widgetShadow ? "0 4px 20px rgba(0,0,0,0.25)" : "none",
        }}
      >
        <WidgetChat clienteId={finalClienteId} config={widgetConfig} hideHeader={false} />
      </div>
    </div>
  )
}
