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
  const { clienteId, position = "bottom-right", embedded = "false" } = searchParams

  console.log("[WIDGET-PAGE] Parámetros recibidos:", { clienteId, position, embedded })

  if (!clienteId) {
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
            Parámetros: {JSON.stringify(searchParams)}
          </div>
        </div>
      </div>
    )
  }

  return <WidgetChat clienteId={clienteId} config={{}} hideHeader={false} />
}
