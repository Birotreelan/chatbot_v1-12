"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmbeddableWidget } from "@/components/chat/embeddable-widget"
import { useToast } from "@/hooks/use-toast"

interface WidgetPreviewProps {
  config: any
}

export function WidgetPreview({ config }: WidgetPreviewProps) {
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState("preview")

  const widgetConfig = {
    title: config.widgetTitle || config.displayName,
    primaryColor: config.widgetPrimaryColor || "#0ea5e9",
    secondaryColor: config.widgetSecondaryColor || "#f0f9ff",
    position: (config.widgetPosition || "bottom-right") as "bottom-right" | "bottom-left",
    welcomeMessage: config.widgetWelcomeMessage || "¡Hola! ¿En qué puedo ayudarte hoy?",
  }

  const embedCode = `<iframe 
  src="${window.location.origin}/widget/${config.id}" 
  width="100%" 
  height="600px" 
  frameBorder="0"
></iframe>`

  const scriptCode = `<script>
  (function(w,d,s,o,f,js,fjs){
    w['ChatWidget']=o;w[o]=w[o]||function(){(w[o].q=w[o].q||[]).push(arguments)};
    js=d.createElement(s),fjs=d.getElementsByTagName(s)[0];
    js.id=o;js.src=f;js.async=1;fjs.parentNode.insertBefore(js,fjs);
  }(window,document,'script','chatWidget','${window.location.origin}/widget-loader.js'));
  chatWidget('init', { configId: '${config.id}' });
</script>`

  const copyToClipboard = (text: string, message: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        toast({
          title: "¡Copiado!",
          description: message,
        })
      })
      .catch((err) => {
        console.error("Error al copiar:", err)
        toast({
          title: "Error",
          description: "No se pudo copiar al portapapeles",
          variant: "destructive",
        })
      })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Widget Web</CardTitle>
        <CardDescription>Previsualiza y obtén el código para integrar el chat en tu sitio web</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="preview">Vista previa</TabsTrigger>
            <TabsTrigger value="embed">Código para embeber</TabsTrigger>
          </TabsList>

          <TabsContent value="preview" className="space-y-4">
            <div className="border rounded-lg h-[400px] relative">
              {config.widgetEnabled ? (
                <EmbeddableWidget configId={config.id} {...widgetConfig} />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-gray-500">El widget está desactivado</p>
                </div>
              )}
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => window.open(`/chat/${config.id}`, "_blank")}>
                Abrir página de demostración
              </Button>

              <Button variant="outline" onClick={() => window.open(`/widget/${config.id}`, "_blank")}>
                Ver widget en pantalla completa
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="embed" className="space-y-4">
            <div>
              <h3 className="font-medium mb-2">Opción 1: Iframe</h3>
              <div className="bg-gray-100 p-4 rounded-md overflow-x-auto">
                <pre className="text-sm">{embedCode}</pre>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => copyToClipboard(embedCode, "Código iframe copiado al portapapeles")}
              >
                Copiar código iframe
              </Button>
            </div>

            <div className="mt-6">
              <h3 className="font-medium mb-2">Opción 2: Script (Próximamente)</h3>
              <div className="bg-gray-100 p-4 rounded-md overflow-x-auto">
                <pre className="text-sm">{scriptCode}</pre>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => copyToClipboard(scriptCode, "Código script copiado al portapapeles")}
              >
                Copiar código script
              </Button>
              <p className="text-sm text-gray-500 mt-2">Nota: La opción de script estará disponible próximamente.</p>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
      <CardFooter className="flex justify-between">
        <p className="text-sm text-gray-500">
          {config.widgetEnabled ? "El widget está habilitado" : "El widget está deshabilitado"}
        </p>
      </CardFooter>
    </Card>
  )
}
