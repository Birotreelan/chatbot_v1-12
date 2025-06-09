import { notFound } from "next/navigation"
import { getWhatsAppConfig } from "@/lib/db"
import { ChatDemo } from "@/components/chat/chat-demo"
import { Suspense } from "react"

interface ChatDemoPageProps {
  params: {
    id: string
  }
  searchParams: {
    embedded?: string
  }
}

export default async function ChatDemoPage({ params, searchParams }: ChatDemoPageProps) {
  console.log("[CHAT PAGE] === INICIO DE CARGA ===")
  console.log("[CHAT PAGE] Parámetros recibidos:")
  console.log("[CHAT PAGE] - params.id:", params.id)
  console.log("[CHAT PAGE] - searchParams:", searchParams)
  console.log("[CHAT PAGE] - embedded:", searchParams.embedded)

  try {
    console.log(`[CHAT PAGE] 🔍 Obteniendo configuración para ID: ${params.id}`)
    const config = await getWhatsAppConfig(params.id)

    if (!config) {
      console.log(`[CHAT PAGE] ❌ Configuración ${params.id} no encontrada`)

      // Agregar logs adicionales para debug
      console.log("[CHAT PAGE] 🔍 Intentando listar todas las configuraciones disponibles...")
      try {
        const { getAllWhatsAppConfigs } = await import("@/lib/db")
        const allConfigs = await getAllWhatsAppConfigs()
        console.log("[CHAT PAGE] Total de configuraciones encontradas:", allConfigs.length)
        console.log(
          "[CHAT PAGE] IDs disponibles:",
          allConfigs.map((c) => ({ id: c.id, cliente_id: c.cliente_id, displayName: c.displayName })),
        )
      } catch (listError) {
        console.error("[CHAT PAGE] Error al listar configuraciones:", listError)
      }

      notFound()
    }

    console.log(`[CHAT PAGE] ✅ Configuración encontrada:`)
    console.log(`[CHAT PAGE] - ID: ${config.id}`)
    console.log(`[CHAT PAGE] - cliente_id: ${config.cliente_id}`)
    console.log(`[CHAT PAGE] - displayName: ${config.displayName}`)
    console.log(`[CHAT PAGE] - widgetEnabled: ${config.widgetEnabled}`)

    if (config.widgetEnabled === false) {
      console.log(`[CHAT PAGE] ❌ Widget deshabilitado para: ${config.displayName}`)
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

    // Verificar si está en modo embebido
    const isEmbedded = searchParams.embedded === "true"
    console.log(`[CHAT PAGE] Modo embebido: ${isEmbedded}`)

    console.log(`[CHAT PAGE] ✅ Renderizando demo para: ${config.displayName}`)

    if (isEmbedded) {
      // Modo embebido para el widget - sin márgenes ni padding
      console.log("[CHAT PAGE] 📱 Renderizando en modo embebido")
      return (
        <div className="h-screen w-full overflow-hidden">
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full">
                <div className="w-8 h-8 border-4 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
              </div>
            }
          >
            <ChatDemo config={config} isEmbedded={true} />
          </Suspense>
        </div>
      )
    }

    // Modo normal
    console.log("[CHAT PAGE] 🖥️ Renderizando en modo normal")
    return (
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-screen">
            <div className="w-16 h-16 border-4 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
          </div>
        }
      >
        <ChatDemo config={config} />
      </Suspense>
    )
  } catch (error) {
    console.error(`[CHAT PAGE] ❌ ERROR CRÍTICO al cargar configuración ${params.id}:`, error)
    console.error(`[CHAT PAGE] Stack trace:`, error instanceof Error ? error.stack : "No stack trace available")

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
