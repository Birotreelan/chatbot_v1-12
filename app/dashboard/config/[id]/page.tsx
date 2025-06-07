import { getWhatsAppConfig } from "@/lib/db"
import { WhatsAppConfigForm } from "@/components/dashboard/whatsapp-config-form"
import { WidgetPreview } from "@/components/dashboard/widget-preview"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { notFound } from "next/navigation"

export default async function ConfigPage({ params }) {
  const config = await getWhatsAppConfig(params.id)

  if (!config) {
    return notFound()
  }

  return (
    <div className="container mx-auto py-6">
      <h1 className="text-2xl font-bold mb-6">Configuración: {config.displayName}</h1>

      <Tabs defaultValue="settings">
        <TabsList className="mb-6">
          <TabsTrigger value="settings">Configuración</TabsTrigger>
          <TabsTrigger value="widget">Widget Web</TabsTrigger>
        </TabsList>

        <TabsContent value="settings">
          <WhatsAppConfigForm config={config} />
        </TabsContent>

        <TabsContent value="widget">
          <WidgetPreview config={config} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
