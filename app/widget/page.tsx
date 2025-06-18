"use client"

import { useEffect, useState } from "react"
import WidgetChat from "@/components/chat/widget-chat"

export default function WidgetPage() {
  const [params, setParams] = useState<{
    clienteId: string
    position: string
    embedded: string
  } | null>(null)

  useEffect(() => {
    console.log("[WIDGET-PAGE] 🚀 === PÁGINA WIDGET CARGANDO ===")
    console.log("[WIDGET-PAGE] 📅 Timestamp:", new Date().toISOString())
    console.log("[WIDGET-PAGE] 🌐 URL:", window.location.href)
    console.log("[WIDGET-PAGE] 🔍 Search:", window.location.search)

    const urlParams = new URLSearchParams(window.location.search)
    const clienteId = urlParams.get("clienteId") || ""
    const position = urlParams.get("position") || "bottom-right"
    const embedded = urlParams.get("embedded") || "false"

    console.log("[WIDGET-PAGE] 📋 Parámetros extraídos:")
    console.log("[WIDGET-PAGE] - clienteId:", clienteId)
    console.log("[WIDGET-PAGE] - position:", position)
    console.log("[WIDGET-PAGE] - embedded:", embedded)

    setParams({ clienteId, position, embedded })
    console.log("[WIDGET-PAGE] ✅ Parámetros establecidos")
  }, [])

  if (!params) {
    console.log("[WIDGET-PAGE] ⏳ Cargando parámetros...")
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Cargando widget...</p>
        </div>
      </div>
    )
  }

  if (!params.clienteId) {
    console.log("[WIDGET-PAGE] ❌ Error: clienteId faltante")
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center p-6 bg-white rounded-lg shadow-md max-w-md">
          <div className="text-red-500 text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Widget no configurado</h2>
          <p className="text-gray-600 mb-4">Se requiere un clienteId válido.</p>
          <div className="text-xs text-gray-400 bg-gray-100 p-2 rounded font-mono">URL: {window.location.href}</div>
        </div>
      </div>
    )
  }

  console.log("[WIDGET-PAGE] 🎨 Renderizando WidgetChat")
  return (
    <div className="h-screen w-full">
      <WidgetChat clienteId={params.clienteId} />
    </div>
  )
}
