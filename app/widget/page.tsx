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

  // Parse config string to JSON object
  let parsedConfig = {}
  try {
    parsedConfig = JSON.parse(config)
  } catch (error) {
    console.error("Error parsing config:", error)
  }

  return (
    <div>
      <WidgetChat
        clienteId={clienteId}
        config={parsedConfig}
        hideHeader={false} // Asegurar que el header se muestre
      />
    </div>
  )
}

export default WidgetPage
