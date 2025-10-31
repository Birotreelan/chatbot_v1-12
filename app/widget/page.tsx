import type React from "react"
import WidgetChat from "@/components/widget-chat"

interface WidgetPageProps {
  searchParams: Promise<{
    clienteId: string
    config: string
    embedded?: string
  }>
}

const WidgetPage: React.FC<WidgetPageProps> = async ({ searchParams }) => {
  const params = await searchParams
  const { clienteId, config, embedded } = params

  if (!clienteId) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-red-600 mb-2">Error de Configuración</h1>
          <p className="text-gray-600">No se proporcionó un ID de cliente válido.</p>
        </div>
      </div>
    )
  }

  let parsedConfig = {}
  try {
    // Solo intentar parsear si config existe y no es "undefined"
    if (config && config !== "undefined" && config !== "null") {
      parsedConfig = JSON.parse(config)
    } else {
      console.warn("[WIDGET] Config no proporcionado o inválido, usando config vacío")
    }
  } catch (error) {
    console.error("[WIDGET] Error parsing config:", error)
    console.error("[WIDGET] Config recibido:", config)
  }

  return (
    <div>
      <WidgetChat clienteId={clienteId} config={parsedConfig} hideHeader={false} />
    </div>
  )
}

export default WidgetPage
