"use client"

import { useSearchParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import WidgetChat from "@/components/chat/widget-chat"
import type { WhatsAppConfig } from "@/lib/types"
import { Suspense } from "react"

export default function WidgetPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen bg-gray-100">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Cargando widget...</p>
          </div>
        </div>
      }
    >
      <WidgetPageContent />
    </Suspense>
  )
}

function WidgetPageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [config, setConfig] = useState<WhatsAppConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const clienteId = searchParams.get("clienteId")
  const position = searchParams.get("position") || "bottom-right"
  const embedded = searchParams.get("embedded") === "true"

  useEffect(() => {
    if (!clienteId) {
      setError("Cliente ID requerido")
      setLoading(false)
      return
    }

    const fetchConfig = async () => {
      try {
        console.log("[WIDGET-PAGE] Obteniendo configuración para cliente:", clienteId)

        const response = await fetch(`/api/widget?cliente_id=${clienteId}`)

        if (!response.ok) {
          throw new Error(`Error ${response.status}: ${response.statusText}`)
        }

        const data = await response.json()
        console.log("[WIDGET-PAGE] Configuración obtenida:", data)

        if (!data.widgetEnabled) {
          throw new Error("Widget no habilitado para este cliente")
        }

        setConfig(data)
      } catch (err) {
        console.error("[WIDGET-PAGE] Error obteniendo configuración:", err)
        setError(err instanceof Error ? err.message : "Error desconocido")
      } finally {
        setLoading(false)
      }
    }

    fetchConfig()
  }, [clienteId])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Cargando widget...</p>
        </div>
      </div>
    )
  }

  if (error || !config) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="text-center p-6 bg-white rounded-lg shadow-md">
          <p className="text-red-600 mb-2">Error al cargar el widget</p>
          <p className="text-gray-600 text-sm">{error}</p>
        </div>
      </div>
    )
  }

  // Si está embebido, usar el chat sin header
  if (embedded) {
    return (
      <div className="h-screen w-full">
        <WidgetChat clienteId={clienteId} config={config} hideHeader={false} />
      </div>
    )
  }

  // Si no está embebido, mostrar como página completa
  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg overflow-hidden" style={{ height: "600px" }}>
        <WidgetChat clienteId={clienteId} config={config} hideHeader={false} />
      </div>
    </div>
  )
}
