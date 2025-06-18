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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          backgroundColor: "#f9fafb",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: "32px",
              height: "32px",
              border: "2px solid #e5e7eb",
              borderTop: "2px solid #3b82f6",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
              margin: "0 auto 16px",
            }}
          ></div>
          <p style={{ color: "#6b7280" }}>Cargando widget...</p>
        </div>
      </div>
    )
  }

  if (!params.clienteId) {
    console.log("[WIDGET-PAGE] ❌ Error: clienteId faltante")
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          backgroundColor: "#f9fafb",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div
          style={{
            textAlign: "center",
            padding: "24px",
            backgroundColor: "white",
            borderRadius: "8px",
            boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
            maxWidth: "400px",
          }}
        >
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>⚠️</div>
          <h2 style={{ fontSize: "20px", fontWeight: "600", color: "#1f2937", marginBottom: "8px" }}>
            Widget no configurado
          </h2>
          <p style={{ color: "#6b7280", marginBottom: "16px" }}>Se requiere un clienteId válido.</p>
          <div
            style={{
              fontSize: "12px",
              color: "#9ca3af",
              backgroundColor: "#f3f4f6",
              padding: "8px",
              borderRadius: "4px",
              fontFamily: "monospace",
            }}
          >
            URL: {window.location.href}
          </div>
        </div>
      </div>
    )
  }

  console.log("[WIDGET-PAGE] 🎨 Renderizando WidgetChat")
  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      <WidgetChat clienteId={params.clienteId} />
    </div>
  )
}
