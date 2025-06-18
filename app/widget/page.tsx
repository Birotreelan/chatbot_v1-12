import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { WidgetChat } from "@/components/widget-chat"
import { getConfigByClienteId } from "@/lib/db"

interface Props {
  searchParams: {
    clienteId: string
    embedded?: string
  }
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { clienteId, embedded } = searchParams

  if (!clienteId) {
    return {
      title: "Widget",
    }
  }

  return {
    title: `Widget - ${clienteId}`,
  }
}

// Obtener configuración del widget
async function getWidgetConfig(clienteId: string) {
  try {
    console.log("[WIDGET-PAGE] 🔍 Obteniendo configuración para cliente:", clienteId)

    // Usar la función de la base de datos para obtener la configuración
    const config = await getConfigByClienteId(clienteId)

    if (!config) {
      console.log("[WIDGET-PAGE] ❌ No se encontró configuración para cliente:", clienteId)
      return null
    }

    console.log("[WIDGET-PAGE] ✅ Configuración encontrada:", {
      widgetTitle: config.widgetTitle,
      widgetSubtitle: config.widgetSubtitle,
      widgetFloatingButtonText: config.widgetFloatingButtonText,
    })

    return config
  } catch (error) {
    console.error("[WIDGET-PAGE] ❌ Error obteniendo configuración:", error)
    return null
  }
}

export default async function Page({ searchParams }: Props) {
  const { clienteId, embedded } = searchParams

  if (!clienteId) {
    notFound()
  }

  const widgetConfig = await getWidgetConfig(clienteId)

  if (!widgetConfig) {
    console.log("[WIDGET-PAGE] ❌ No se renderizará el widget por falta de configuración")
    return (
      <div>
        <p>No se puede mostrar el widget porque no hay configuración para este cliente.</p>
      </div>
    )
  }

  return (
    <>
      <WidgetChat clienteId={clienteId} config={widgetConfig} hideHeader={embedded === "true"} />
    </>
  )
}
