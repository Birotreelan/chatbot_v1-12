import { Suspense } from "react"
import WidgetChat from "@/components/chat/widget-chat"

interface SearchParams {
  clienteId?: string
  position?: string
  embedded?: string
}

interface WidgetPageProps {
  searchParams: SearchParams
}

function WidgetContent({ searchParams }: WidgetPageProps) {
  const { clienteId, position = "bottom-right", embedded = "false" } = searchParams

  console.log("[WIDGET-PAGE] Parámetros recibidos:", { clienteId, position, embedded })

  if (!clienteId) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center p-6 bg-white rounded-lg shadow-md max-w-md">
          <div className="text-red-500 text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Widget no configurado</h2>
          <p className="text-gray-600 mb-4">Se requiere un clienteId válido para cargar el widget.</p>
          <div className="text-xs text-gray-400 bg-gray-100 p-2 rounded">
            Parámetros recibidos: {JSON.stringify(searchParams)}
          </div>
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
    <html lang="es">
      <head>
        <title>Widget Chat - Treelan</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-screen bg-gray-50">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto mb-4"></div>
                <p className="text-gray-600">Cargando widget...</p>
              </div>
            </div>
          }
        >
          <WidgetContent searchParams={searchParams} />
        </Suspense>
      </body>
    </html>
  )
}
