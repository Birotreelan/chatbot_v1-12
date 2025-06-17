"use client"

import { useEffect, useState } from "react"
import WidgetChat from "@/components/chat/widget-chat"

interface SearchParams {
  clienteId?: string
  position?: string
  embedded?: string
}

interface WidgetPageProps {
  searchParams: SearchParams
}

export default function WidgetPage({ searchParams }: WidgetPageProps) {
  const [mounted, setMounted] = useState(false)
  const [params, setParams] = useState<SearchParams>({})

  useEffect(() => {
    console.log("[WIDGET-PAGE] 🔄 Componente montándose...")

    // Obtener parámetros de la URL en el cliente
    const urlParams = new URLSearchParams(window.location.search)
    const clientParams = {
      clienteId: urlParams.get("clienteId") || undefined,
      position: urlParams.get("position") || "bottom-right",
      embedded: urlParams.get("embedded") || "false",
    }

    console.log("[WIDGET-PAGE] 📋 Parámetros de URL:", clientParams)
    setParams(clientParams)
    setMounted(true)
    console.log("[WIDGET-PAGE] ✅ Componente montado correctamente")
  }, [])

  // Loading state mientras se monta
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
              borderTop: "2px solid #0ea5e9",
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

  // Error state si no hay clienteId
  if (!params.clienteId) {
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

  console.log("[WIDGET-PAGE] 🚀 Renderizando WidgetChat con:", params)
  return (
    <div style={{ height: "100vh", width: "100%" }}>
      <WidgetChat clienteId={params.clienteId} config={{}} hideHeader={false} />
    </div>
  )
}
