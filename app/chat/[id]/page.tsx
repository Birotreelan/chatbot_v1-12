"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import WidgetChat from "@/components/chat/widget-chat"

interface ChatConfig {
  id: string
  name: string
  clienteId: string
  widgetTitle?: string
  widgetSubtitle?: string
  widgetWelcomeMessage?: string
  widgetPlaceholder?: string
  widgetPrimaryColor?: string
  widgetSecondaryColor?: string
}

export default function ChatPage({ params }: { params: { id: string } }) {
  const [config, setConfig] = useState<ChatConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const searchParams = useSearchParams()
  const isEmbedded = searchParams.get("embedded") === "true"

  useEffect(() => {
    async function fetchConfig() {
      try {
        const response = await fetch(`/api/dashboard/configs/${params.id}`)
        if (!response.ok) {
          throw new Error(`Error ${response.status}: ${response.statusText}`)
        }
        const data = await response.json()
        setConfig(data)
      } catch (err) {
        console.error("Error fetching config:", err)
        setError("No se pudo cargar la configuración del chat")
      } finally {
        setLoading(false)
      }
    }

    fetchConfig()
  }, [params.id])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-16 h-16 border-4 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
      </div>
    )
  }

  if (error || !config) {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <div className="text-red-500 text-xl">{error || "Configuración no encontrada"}</div>
      </div>
    )
  }

  // Si está embebido, aplicar estilos específicos para el widget
  if (isEmbedded) {
    return (
      <div className="h-screen w-full overflow-hidden">
        <WidgetChat clienteId={config.clienteId} config={config} />
      </div>
    )
  }

  // Vista normal para la página de chat
  return (
    <div className="max-w-md mx-auto h-screen md:h-[600px] md:my-8 border rounded-lg overflow-hidden shadow-lg">
      <WidgetChat clienteId={config.clienteId} config={config} />
    </div>
  )
}
