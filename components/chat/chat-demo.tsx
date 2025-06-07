"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Copy, ExternalLink, CheckCircle, Loader2 } from "lucide-react"
import type { WhatsAppConfig } from "@/lib/types"

interface ChatDemoProps {
  config: WhatsAppConfig
}

export function ChatDemo({ config }: ChatDemoProps) {
  const [widgetLoaded, setWidgetLoaded] = useState(false)
  const [currentUrl, setCurrentUrl] = useState("")

  useEffect(() => {
    // Solo ejecutar en el cliente
    if (typeof window !== "undefined") {
      setCurrentUrl(window.location.origin)

      // Cargar el widget
      const script = document.createElement("script")
      script.src = "/widget-loader.js"
      script.onload = () => {
        // Inicializar el widget con la configuración específica
        if (window.WhatsAppWidget) {
          window.WhatsAppWidget.init({
            cliente_id: config.cliente_id,
            position: config.widgetPosition || "bottom-right",
            primaryColor: config.widgetPrimaryColor || "#25D366",
            textColor: config.widgetTextColor || "#ffffff",
            welcomeMessage: config.widgetWelcomeMessage || "¡Hola! ¿En qué puedo ayudarte?",
            placeholder: config.widgetPlaceholder || "Escribe tu mensaje...",
            size: config.widgetSize || "medium",
          })
          setWidgetLoaded(true)
        }
      }
      document.head.appendChild(script)

      // Cleanup
      return () => {
        if (document.head.contains(script)) {
          document.head.removeChild(script)
        }
        // Limpiar el widget si existe
        if (window.WhatsAppWidget && window.WhatsAppWidget.destroy) {
          window.WhatsAppWidget.destroy()
        }
      }
    }
  }, [config])

  const copyToClipboard = async (text: string) => {
    if (typeof window !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text)
        // Aquí podrías añadir una notificación de éxito
      } catch (err) {
        console.error("Error al copiar:", err)
      }
    }
  }

  const widgetUrl = `${currentUrl}/widget/${config.cliente_id}`
  const demoUrl = `${currentUrl}/chat/${config.id}`

  const jsCode = `<!-- Widget de Chat WhatsApp -->
<script src="${currentUrl}/widget-loader.js"></script>
<script>
  WhatsAppWidget.init({
    cliente_id: '${config.cliente_id}',
    position: '${config.widgetPosition || "bottom-right"}',
    primaryColor: '${config.widgetPrimaryColor || "#25D366"}',
    textColor: '${config.widgetTextColor || "#ffffff"}',
    welcomeMessage: '${config.widgetWelcomeMessage || "¡Hola! ¿En qué puedo ayudarte?"}',
    placeholder: '${config.widgetPlaceholder || "Escribe tu mensaje..."}',
    size: '${config.widgetSize || "medium"}'
  });
</script>`

  const iframeCode = `<!-- Widget de Chat WhatsApp (iframe) -->
<iframe 
  src="${widgetUrl}" 
  width="400" 
  height="600" 
  frameborder="0"
  style="border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
</iframe>`

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold text-gray-900">Demostración del Widget de Chat</h1>
          <p className="text-xl text-gray-600">
            Configuración: <span className="font-semibold">{config.displayName}</span>
          </p>
        </div>

        {/* Status del Widget */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Estado del Widget
              {widgetLoaded ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : (
                <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Badge variant={widgetLoaded ? "default" : "secondary"}>{widgetLoaded ? "Cargado" : "Cargando..."}</Badge>
              <span className="text-sm text-gray-600">
                {widgetLoaded
                  ? "El widget está funcionando correctamente. Busca el botón azul en la esquina inferior derecha."
                  : "Cargando el widget de chat..."}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Grid de información */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Configuración Actual */}
          <Card>
            <CardHeader>
              <CardTitle>Configuración Actual</CardTitle>
              <CardDescription>Personalización aplicada a este widget</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium">Posición:</span>
                  <p className="text-gray-600">{config.widgetPosition || "bottom-right"}</p>
                </div>
                <div>
                  <span className="font-medium">Tamaño:</span>
                  <p className="text-gray-600">{config.widgetSize || "medium"}</p>
                </div>
                <div>
                  <span className="font-medium">Color Principal:</span>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-4 h-4 rounded border"
                      style={{ backgroundColor: config.widgetPrimaryColor || "#25D366" }}
                    />
                    <span className="text-gray-600">{config.widgetPrimaryColor || "#25D366"}</span>
                  </div>
                </div>
                <div>
                  <span className="font-medium">Color de Texto:</span>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-4 h-4 rounded border"
                      style={{ backgroundColor: config.widgetTextColor || "#ffffff" }}
                    />
                    <span className="text-gray-600">{config.widgetTextColor || "#ffffff"}</span>
                  </div>
                </div>
              </div>
              <div>
                <span className="font-medium">Mensaje de Bienvenida:</span>
                <p className="text-gray-600 text-sm mt-1">
                  "{config.widgetWelcomeMessage || "¡Hola! ¿En qué puedo ayudarte?"}"
                </p>
              </div>
              <div>
                <span className="font-medium">Placeholder:</span>
                <p className="text-gray-600 text-sm mt-1">"{config.widgetPlaceholder || "Escribe tu mensaje..."}"</p>
              </div>
            </CardContent>
          </Card>

          {/* URLs y Enlaces */}
          <Card>
            <CardHeader>
              <CardTitle>URLs y Enlaces</CardTitle>
              <CardDescription>Enlaces para integración y demostración</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">URL del Widget</label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="text"
                    value={widgetUrl}
                    readOnly
                    className="flex-1 px-3 py-2 text-sm border rounded-md bg-gray-50"
                  />
                  <Button size="sm" variant="outline" onClick={() => copyToClipboard(widgetUrl)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => window.open(widgetUrl, "_blank")}>
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">URL de Demostración</label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="text"
                    value={demoUrl}
                    readOnly
                    className="flex-1 px-3 py-2 text-sm border rounded-md bg-gray-50"
                  />
                  <Button size="sm" variant="outline" onClick={() => copyToClipboard(demoUrl)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Códigos de Integración */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Código JavaScript */}
          <Card>
            <CardHeader>
              <CardTitle>Integración JavaScript</CardTitle>
              <CardDescription>
                Copia este código en tu sitio web antes del cierre del tag &lt;/body&gt;
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm overflow-x-auto">
                  <code>{jsCode}</code>
                </pre>
                <Button
                  size="sm"
                  variant="outline"
                  className="absolute top-2 right-2"
                  onClick={() => copyToClipboard(jsCode)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Código iframe */}
          <Card>
            <CardHeader>
              <CardTitle>Integración iframe</CardTitle>
              <CardDescription>Alternativa usando iframe para sitios con restricciones de JavaScript</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm overflow-x-auto">
                  <code>{iframeCode}</code>
                </pre>
                <Button
                  size="sm"
                  variant="outline"
                  className="absolute top-2 right-2"
                  onClick={() => copyToClipboard(iframeCode)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Instrucciones */}
        <Card>
          <CardHeader>
            <CardTitle>Instrucciones de Uso</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <h4 className="font-medium">1. Probar el Widget</h4>
                <p className="text-sm text-gray-600">
                  Busca el botón de chat en la esquina inferior derecha de esta página y haz clic para probarlo.
                </p>
              </div>
              <div>
                <h4 className="font-medium">2. Integrar en tu Sitio Web</h4>
                <p className="text-sm text-gray-600">
                  Copia el código JavaScript o iframe de arriba e intégralo en tu sitio web.
                </p>
              </div>
              <div>
                <h4 className="font-medium">3. Personalizar</h4>
                <p className="text-sm text-gray-600">
                  Modifica los colores, mensajes y configuración desde el panel de administración.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// Declaración de tipos para el widget global
declare global {
  interface Window {
    WhatsAppWidget: {
      init: (config: any) => void
      destroy?: () => void
    }
  }
}
