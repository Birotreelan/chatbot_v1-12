import type React from "react"
import WidgetChat from "@/components/widget-chat"

interface WidgetPageProps {
  searchParams: {
    clienteId: string
    config: string
    embedded?: string
  }
}

const WidgetPage: React.FC<WidgetPageProps> = ({ searchParams }) => {
  const { clienteId, config, embedded } = searchParams

  // Parse config string to JSON object - MEJORADO
  let parsedConfig = {}
  try {
    if (config && config !== "undefined") {
      parsedConfig = JSON.parse(config)
    }
  } catch (error) {
    console.error("Error parsing config:", error)
    // Usar configuración por defecto si hay error
    parsedConfig = {}
  }

  return (
    <div>
      <WidgetChat clienteId={clienteId} config={parsedConfig} hideHeader={false} />
    </div>
  )
}

export default WidgetPage
