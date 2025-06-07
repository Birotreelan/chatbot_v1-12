import { notFound } from "next/navigation"
import { getWhatsAppConfig } from "@/lib/db"
import { WhatsAppConfigForm } from "@/components/dashboard/whatsapp-config-form"

interface ConfigPageProps {
  params: {
    id: string
  }
}

export default async function ConfigPage({ params }: ConfigPageProps) {
  console.log(`[CONFIG PAGE] Intentando cargar configuración para ID: ${params.id}`)

  try {
    const config = await getWhatsAppConfig(params.id)

    if (!config) {
      console.log(`[CONFIG PAGE] Configuración ${params.id} no encontrada`)
      notFound()
    }

    console.log(`[CONFIG PAGE] Configuración obtenida: ${config ? "Encontrada" : "No encontrada"}`)
    console.log(`[CONFIG PAGE] Renderizando página para configuración: ${config.displayName}`)

    return (
      <div className="container mx-auto py-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Editar Configuración</h1>
          <p className="text-gray-600 mt-2">
            Configuración para: <span className="font-semibold">{config.displayName}</span>
          </p>
        </div>

        <WhatsAppConfigForm config={config} />
      </div>
    )
  } catch (error) {
    console.error(`[CONFIG PAGE] Error al cargar configuración ${params.id}:`, error)

    return (
      <div className="container mx-auto py-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-red-800 mb-2">Error al cargar la configuración</h2>
          <p className="text-red-600 mb-4">No se pudo cargar la configuración solicitada.</p>
          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-red-700">Ver detalles del error</summary>
            <pre className="mt-2 bg-red-100 p-2 rounded text-xs overflow-auto">
              {error instanceof Error ? error.message : String(error)}
            </pre>
          </details>
        </div>
      </div>
    )
  }
}

export const dynamic = "force-dynamic"
