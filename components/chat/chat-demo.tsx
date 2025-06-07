"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Copy, ExternalLink, Settings, Palette, MessageCircle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import type { WhatsAppConfig } from "@/lib/types"

interface ChatDemoProps {
  config: WhatsAppConfig
}

export function ChatDemo({ config }: ChatDemoProps) {
  const [isWidgetLoaded, setIsWidgetLoaded] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    // Cargar el widget después de que el componente se monte
    const script = document.createElement("script")
    script.src = "/widget-loader.js"
    script.setAttribute("data-client-id", config.cliente_id || config.id)
    script.onload = () => {
      console.log("[CHAT DEMO] Widget cargado exitosamente")
      setIsWidgetLoaded(true)
    }
    script.onerror = () => {
      console.error("[CHAT DEMO] Error al cargar el widget")
      toast({
        title: "Error",
        description: "No se pudo cargar el widget de chat",
        variant: "destructive",
      })
    }

    document.body.appendChild(script)

    return () => {
      // Limpiar el script al desmontar
      const existingScript = document.querySelector(`script[data-client-id="${config.cliente_id || config.id}"]`)
      if (existingScript) {
        existingScript.remove()
      }
      // Limpiar el widget si existe
      const widget = document.getElementById("ai-chat-widget")
      if (widget) {
        widget.remove()
      }
    }
  }, [config.cliente_id, config.id, toast])

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast({
      title: "Copiado",
      description: "El texto se ha copiado al portapapeles.",
    })
  }

  const getWidgetUrl = () => {
    return `${window.location.origin}/widget/${config.id}`
  }

  const getCurrentDemoUrl = () => {
    return window.location.href
  }

  const getEmbedCode = () => {
    return `<iframe src="${getWidgetUrl()}" width="${config.widgetMaxWidth || 400}" height="${config.widgetMaxHeight || 600}" frameborder="0" style="border-radius: ${config.widgetBorderRadius || 12}px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);"></iframe>`
  }

  const getJavaScriptCode = () => {
    if (!config.cliente_id) return "// Se requiere cliente_id para generar el código"
    return `<script src="${window.location.origin}/widget-loader.js" data-client-id="${config.cliente_id}"></script>`
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Demostración del Widget</h1>
              <p className="text-gray-600">{config.displayName}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={config.active ? "default" : "secondary"}>{config.active ? "Activo" : "Inactivo"}</Badge>
              <Badge variant={isWidgetLoaded ? "default" : "outline"}>
                {isWidgetLoaded ? "Widget Cargado" : "Cargando..."}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Panel de Información */}
          <div className="space-y-6">
            {/* Configuración del Widget */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Configuración del Widget
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium text-gray-700">Título:</span>
                    <p className="text-gray-600">{config.widgetTitle || "Asistente Virtual"}</p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Posición:</span>
                    <p className="text-gray-600">
                      {config.widgetPosition === "bottom-right" ? "Inferior Derecha" : "Inferior Izquierda"}
                    </p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Tema:</span>
                    <p className="text-gray-600 capitalize">{config.widgetTheme || "light"}</p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Animaciones:</span>
                    <p className="text-gray-600">{config.widgetAnimation ? "Habilitadas" : "Deshabilitadas"}</p>
                  </div>
                </div>

                <Separator />

                <div>
                  <span className="font-medium text-gray-700">Mensaje de Bienvenida:</span>
                  <p className="text-gray-600 text-sm mt-1">
                    {config.widgetWelcomeMessage || "¡Hola! ¿En qué puedo ayudarte hoy?"}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Personalización Visual */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Palette className="h-5 w-5" />
                  Personalización Visual
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="font-medium text-gray-700">Color Primario:</span>
                    <div className="flex items-center gap-2 mt-1">
                      <div
                        className="w-6 h-6 rounded border"
                        style={{ backgroundColor: config.widgetPrimaryColor || "#0ea5e9" }}
                      />
                      <span className="text-sm text-gray-600">{config.widgetPrimaryColor || "#0ea5e9"}</span>
                    </div>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Color Secundario:</span>
                    <div className="flex items-center gap-2 mt-1">
                      <div
                        className="w-6 h-6 rounded border"
                        style={{ backgroundColor: config.widgetSecondaryColor || "#f0f9ff" }}
                      />
                      <span className="text-sm text-gray-600">{config.widgetSecondaryColor || "#f0f9ff"}</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="font-medium text-gray-700">Ancho:</span>
                    <p className="text-gray-600">{config.widgetMaxWidth || 400}px</p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Alto:</span>
                    <p className="text-gray-600">{config.widgetMaxHeight || 600}px</p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Radio:</span>
                    <p className="text-gray-600">{config.widgetBorderRadius || 12}px</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* URLs y Códigos */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ExternalLink className="h-5 w-5" />
                  Integración
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">URL del Widget</label>
                  <div className="flex gap-2 mt-1">
                    <input
                      type="text"
                      value={getWidgetUrl()}
                      readOnly
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm bg-gray-50"
                    />
                    <Button variant="outline" size="sm" onClick={() => copyToClipboard(getWidgetUrl())}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700">Página de Demostración</label>
                  <div className="flex gap-2 mt-1">
                    <input
                      type="text"
                      value={getCurrentDemoUrl()}
                      readOnly
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm bg-gray-50"
                    />
                    <Button variant="outline" size="sm" onClick={() => copyToClipboard(getCurrentDemoUrl())}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <Separator />

                <div>
                  <label className="text-sm font-medium text-gray-700">Código JavaScript</label>
                  <textarea
                    value={getJavaScriptCode()}
                    readOnly
                    rows={2}
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md text-sm bg-gray-50 font-mono"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => copyToClipboard(getJavaScriptCode())}
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    Copiar Código
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Panel de Demostración */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageCircle className="h-5 w-5" />
                  Vista Previa del Widget
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-gray-100 rounded-lg p-8 min-h-[400px] relative">
                  <div className="text-center text-gray-600">
                    <MessageCircle className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                    <h3 className="text-lg font-medium mb-2">Widget de Chat en Vivo</h3>
                    <p className="text-sm mb-4">
                      El widget aparecerá en la esquina{" "}
                      {config.widgetPosition === "bottom-right" ? "inferior derecha" : "inferior izquierda"} de esta
                      página.
                    </p>
                    {!isWidgetLoaded && (
                      <div className="inline-flex items-center gap-2 text-blue-600">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                        Cargando widget...
                      </div>
                    )}
                    {isWidgetLoaded && (
                      <Badge variant="default" className="bg-green-600">
                        ✓ Widget cargado - Haz clic en el botón azul para probarlo
                      </Badge>
                    )}
                  </div>

                  {/* Simulación visual del widget */}
                  <div
                    className={`absolute bottom-4 ${
                      config.widgetPosition === "bottom-left" ? "left-4" : "right-4"
                    } w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-white opacity-50`}
                    style={{ backgroundColor: config.widgetPrimaryColor || "#0ea5e9" }}
                  >
                    <MessageCircle className="h-6 w-6" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Instrucciones */}
            <Card>
              <CardHeader>
                <CardTitle>Instrucciones de Uso</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-gray-600">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                    1
                  </div>
                  <p>
                    <strong>Prueba el widget:</strong> Haz clic en el botón de chat que aparece en la esquina de la
                    página para probar la funcionalidad.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                    2
                  </div>
                  <p>
                    <strong>Integra en tu sitio:</strong> Copia el código JavaScript y pégalo antes del cierre del tag
                    &lt;/body&gt; en tu sitio web.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                    3
                  </div>
                  <p>
                    <strong>Personaliza:</strong> Modifica los colores, textos y comportamiento desde la configuración
                    del widget.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
