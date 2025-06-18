"use client"

import { useEffect, useState } from "react"
import WidgetChat from "@/components/chat/widget-chat"

export default function WidgetPage() {
  const [mounted, setMounted] = useState(false)
  const [clienteId, setClienteId] = useState<string>("")
  const [position, setPosition] = useState<string>("bottom-right")
  const [embedded, setEmbedded] = useState<boolean>(false)

  useEffect(() => {
    // Solo ejecutar en el cliente
    const urlParams = new URLSearchParams(window.location.search)
    const clienteIdParam = urlParams.get("clienteId") || ""
    const positionParam = urlParams.get("position") || "bottom-right"
    const embeddedParam = urlParams.get("embedded") === "true"

    console.log("[WIDGET-PAGE] 📋 Parámetros de URL:", {
      clienteId: clienteIdParam,
      position: positionParam,
      embedded: embeddedParam,
    })

    setClienteId(clienteIdParam)
    setPosition(positionParam)
    setEmbedded(embeddedParam)
    setMounted(true)
    console.log("[WIDGET-PAGE] ✅ Componente montado correctamente")
  }, [])

  if (!mounted) {
    console.log("[WIDGET-PAGE] ⏳ Mostrando loading...")
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
              borderTop: "2px solid #16a34a",
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

  if (!clienteId) {
    console.log("[WIDGET-PAGE] ❌ Error: No clienteId")
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
          <p style={{ color: "#6b7280", marginBottom: "16px" }}>
            Se requiere un clienteId válido para cargar el widget.
          </p>
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
            URL: {typeof window !== "undefined" ? window.location.href : "N/A"}
          </div>
        </div>
      </div>
    )
  }

  console.log("[WIDGET-PAGE] 🚀 Renderizando WidgetChat con:", { clienteId, position, embedded })
  return (
    <div style={{ height: "100vh", width: "100vw", margin: 0, padding: 0 }}>
      <WidgetChat clienteId={clienteId} config={{}} hideHeader={false} />
    </div>
  )
}
