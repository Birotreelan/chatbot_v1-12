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

  let parsedConfig = {}
  if (config && config !== "undefined") {
    try {
      parsedConfig = JSON.parse(config)
    } catch (error) {
      console.error("Error parsing config:", error)
    }
  }

  return (
    <div>
      <WidgetChat clienteId={clienteId} config={parsedConfig} hideHeader={false} />
    </div>
  )
}

export default WidgetPage
