import { Suspense } from "react"
import { WidgetChat } from "@/components/chat/widget-chat"

interface WidgetPageProps {
  searchParams: {
    clienteId?: string
    position?: string
    embedded?: string
  }
}

function WidgetContent({ searchParams }: WidgetPageProps) {
  const { clienteId, position = "bottom-right", embedded = "false" } = searchParams

  if (!clienteId) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Widget no configurado</h2>
          <p className="text-gray-600">Se requiere un clienteId válido para cargar el widget.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen w-full">
      <WidgetChat clienteId={clienteId} position={position} embedded={embedded === "true"} />
    </div>
  )
}

export default function WidgetPage({ searchParams }: WidgetPageProps) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen bg-gray-50">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Cargando widget...</p>
          </div>
        </div>
      }
    >
      <WidgetContent searchParams={searchParams} />
    </Suspense>
  )
}
