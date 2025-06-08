"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Copy, ExternalLink, CheckCircle, Loader2, MessageCircle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import type { WhatsAppConfig } from "@/lib/types"

interface ChatDemoProps {
  config: WhatsAppConfig
}

export function ChatDemo({ config }: ChatDemoProps) {
  const [widgetLoaded, setWidgetLoaded] = useState(false)
  const [currentUrl, setCurrentUrl] = useState("")
  const [widgetError, setWidgetError] = useState<string | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    // Solo ejecutar en el cliente
    if (typeof window !== "undefined") {
      setCurrentUrl(window.location.origin)

      // Limpiar cualquier widget existente
      if (window.TreelanChatWidget) {
        window.TreelanChatWidget.destroy()
      }

      // Cargar el widget
      const script = document.createElement("script")
      script.src = "/widget-loader.js"
      script.setAttribute("data-client-id", config.cliente_id || config.id)

      script.onload = () => {
        console.log("[CHAT DEMO] Widget script cargado")
        // Dar tiempo para que el widget se inicialice
        setTimeout(() => {
          if (window.TreelanChatWidget) {
            setWidgetLoaded(true)
            console.log("[CHAT DEMO] Widget inicializado correctamente")
          } else {
            setWidgetError("El widget no se inicializó correctamente")
          }
        }, 1000)
      }

      script.onerror = () => {
        console.error("[CHAT DEMO] Error al cargar el script del widget")
        setWidgetError("Error al cargar el script del widget")
      }

      document.head.appendChild(script)

      // Cleanup
      return () => {
        if (document.head.contains(script)) {
          document.head.removeChild(script)
        }
        // Limpiar el widget si existe
        if (window.TreelanChatWidget) {
          window.TreelanChatWidget.destroy()
        }
      }
    }
  }, [config.cliente_id, config.id])

  const copyToClipboard = async (text: string) => {
    if (typeof window !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text)
        toast({
          title: "Copiado",
          description: "El texto se ha copiado al portapapeles.",
        })
      } catch (err) {
        console.error("Error al copiar:", err)
        toast({
          title: "Error",
          description: "No se pudo copiar el texto.",
          variant: "destructive",
        })
      }
    }
  }

  const openWidget = () => {
    if (window.TreelanChatWidget) {
      window.TreelanChatWidget.open()
    }
  }

  const widgetUrl = `${currentUrl}/api/widget?cliente_id=${config.cliente_id || config.id}`
  const demoUrl = `${currentUrl}/chat/${config.id}`

  const jsCode = `<!-- Widget de Chat -->
<script src="${currentUrl}/widget-loader.js" data-client-id="${config.cliente_id || config.id}"></script>`

  const iframeCode = `<!-- Widget de Chat (iframe) -->
<iframe 
  src="${widgetUrl}" 
  width="${config.widgetMaxWidth || 400}" 
  height="${config.widgetMaxHeight || 600}" 
  frameborder="0"
  style="border-radius: ${config.widgetBorderRadius || 12}px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
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
              {widgetError ? (
                <div className="h-5 w-5 text-red-500">❌</div>
              ) : widgetLoaded ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : (
                <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Badge variant={widgetError ? "destructive" : widgetLoaded ? "default" : "secondary"}>
                {widgetError ? "Error" : widgetLoaded ? "Cargado" : "Cargando..."}
              </Badge>
              <span className="text-sm text-gray-600">
                {widgetError
                  ? `Error: ${widgetError}`
                  : widgetLoaded
                    ? "El widget está funcionando correctamente. Busca el botón azul en la esquina inferior derecha."
                    : "Cargando el widget de chat..."}
              </span>
            </div>
            {widgetLoaded && (
              <div className="mt-4">
                <Button onClick={openWidget} className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4" />
                  Abrir Widget
                </Button>
              </div>
            )}
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
                  <span className="font-medium">Cliente ID:</span>
                  <p className="text-gray-600">{config.cliente_id || config.id}</p>
                </div>
                <div>
                  <span className="font-medium">Posición:</span>
                  <p className="text-gray-600">
                    {config.widgetPosition === "bottom-right" ? "Inferior Derecha" : "Inferior Izquierda"}
                  </p>
                </div>
                <div>
                  <span className="font-medium">Color Principal:</span>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-4 h-4 rounded border"
                      style={{ backgroundColor: config.widgetPrimaryColor || "#0ea5e9" }}
                    />
                    <span className="text-gray-600">{config.widgetPrimaryColor || "#0ea5e9"}</span>
                  </div>
                </div>
                <div>
                  <span className="font-medium">Tema:</span>
                  <p className="text-gray-600 capitalize">{config.widgetTheme || "light"}</p>
                </div>
              </div>
              <div>
                <span className="font-medium">Mensaje de Bienvenida:</span>
                <p className="text-gray-600 text-sm mt-1">
                  "{config.widgetWelcomeMessage || "¡Hola! ¿En qué puedo ayudarte hoy?"}"
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
                  Busca el botón de chat en la esquina inferior derecha de esta página y haz clic para probarlo, o usa
                  el botón "Abrir Widget" de arriba.
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
    TreelanChatWidget: {
      open: () => void
      close: () => void
      toggle: () => void
      destroy: () => void
      isOpen: () => boolean
      clienteId: string
    }
  }
}
