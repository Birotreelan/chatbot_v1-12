import { notFound } from "next/navigation"
import { WhatsAppConfigForm } from "@/components/dashboard/whatsapp-config-form"
import { ApiTestTool } from "@/components/dashboard/api-test-tool"
import { getWhatsAppConfig } from "@/lib/db"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ClienteIdTest } from "@/components/dashboard/cliente-id-test"
import { TemplateMessageTool } from "@/components/dashboard/template-message-tool"
import { WhatsAppTemplates } from "@/components/dashboard/whatsapp-templates"

interface WhatsAppConfigPageProps {
  params: {
    id: string
  }
}

export default async function WhatsAppConfigPage({ params }: WhatsAppConfigPageProps) {
  console.log(`[CONFIG PAGE] Intentando cargar configuración para ID: ${params.id}`)

  try {
    const config = await getWhatsAppConfig(params.id)
    console.log(`[CONFIG PAGE] Configuración obtenida:`, config ? "Encontrada" : "No encontrada")

    if (!config) {
      console.log(`[CONFIG PAGE] Configuración no encontrada para ID: ${params.id}`)
      notFound()
    }

    console.log(`[CONFIG PAGE] Renderizando página para configuración: ${config.displayName}`)

    return (
      <div className="container mx-auto py-8">
        <h1 className="text-3xl font-bold mb-8">Configuración: {config.displayName}</h1>
        <p className="text-sm text-gray-600 mb-6">
          ID: {config.id} | Estado: {config.active ? "Activo" : "Inactivo"}
        </p>

        <Tabs defaultValue="config" className="w-full">
          <TabsList className="mb-6">
            <TabsTrigger value="config">Configuración</TabsTrigger>
            <TabsTrigger value="api-test">Prueba de API</TabsTrigger>
            <TabsTrigger value="cliente-id-test">Prueba de Cliente_Id</TabsTrigger>
            <TabsTrigger value="template-message">Mensajes de Plantilla</TabsTrigger>
            <TabsTrigger value="templates">Plantillas</TabsTrigger>
          </TabsList>

          <TabsContent value="config">
            <WhatsAppConfigForm config={config} />
          </TabsContent>

          <TabsContent value="api-test">
            <ApiTestTool config={config} />
          </TabsContent>

          <TabsContent value="cliente-id-test">
            <ClienteIdTest config={config} />
          </TabsContent>

          <TabsContent value="template-message">
            <TemplateMessageTool config={config} />
          </TabsContent>

          <TabsContent value="templates">
            <WhatsAppTemplates config={config} />
          </TabsContent>
        </Tabs>
      </div>
    )
  } catch (error) {
    console.error(`[CONFIG PAGE] Error al cargar configuración para ID ${params.id}:`, error)

    return (
      <div className="container mx-auto py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h1 className="text-2xl font-bold text-red-800 mb-4">Error al cargar la configuración</h1>
          <p className="text-red-700 mb-4">
            No se pudo cargar la configuración con ID: <code className="bg-red-100 px-2 py-1 rounded">{params.id}</code>
          </p>
          <details className="text-sm text-red-600">
            <summary className="cursor-pointer font-medium">Detalles del error</summary>
            <pre className="mt-2 bg-red-100 p-2 rounded overflow-auto">
              {error instanceof Error ? error.message : String(error)}
            </pre>
          </details>
          <div className="mt-4">
            <a href="/dashboard" className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
              Volver al Dashboard
            </a>
          </div>
        </div>
      </div>
    )
  }
}

export const dynamic = "force-dynamic"
