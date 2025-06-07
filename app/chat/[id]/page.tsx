import { notFound } from "next/navigation"
import { getWhatsAppConfig } from "@/lib/db"
import { ChatDemo } from "@/components/chat/chat-demo"

interface ChatDemoPageProps {
  params: {
    id: string
  }
}

export default async function ChatDemoPage({ params }: ChatDemoPageProps) {
  console.log(`[CHAT DEMO] Cargando demo para configuración: ${params.id}`)

  try {
    const config = await getWhatsAppConfig(params.id)

    if (!config) {
      console.log(`[CHAT DEMO] Configuración ${params.id} no encontrada`)
      notFound()
    }

    if (!config.widgetEnabled) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
            <div className="text-6xl mb-4">🚫</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-4">Widget Deshabilitado</h1>
            <p className="text-gray-600 mb-6">El widget web no está habilitado para esta configuración.</p>
            <p className="text-sm text-gray-500">Contacta al administrador para habilitar el widget.</p>
          </div>
        </div>
      )
    }

    console.log(`[CHAT DEMO] Renderizando demo para: ${config.displayName}`)

    return <ChatDemo config={config} />
  } catch (error) {
    console.error(`[CHAT DEMO] Error al cargar configuración ${params.id}:`, error)

    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-6xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold text-red-600 mb-4">Error</h1>
          <p className="text-gray-600 mb-6">No se pudo cargar la configuración del chat.</p>
          <details className="text-left text-sm text-gray-500">
            <summary className="cursor-pointer font-medium">Detalles del error</summary>
            <pre className="mt-2 bg-gray-100 p-2 rounded overflow-auto">
              {error instanceof Error ? error.message : String(error)}
            </pre>
          </details>
        </div>
      </div>
    )
  }
}

export const dynamic = "force-dynamic"
