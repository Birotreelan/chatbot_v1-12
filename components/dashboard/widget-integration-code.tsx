"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Copy, Check } from "lucide-react"
import type { WhatsAppConfig } from "@/lib/types"

interface WidgetIntegrationCodeProps {
  config: WhatsAppConfig
}

export default function WidgetIntegrationCode({ config }: WidgetIntegrationCodeProps) {
  const [copied, setCopied] = useState(false)

  // Obtener la URL base actual
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://tu-dominio.com"

  const integrationCode = `<!-- Widget de Chat - ${config.displayName} -->
<script 
  src="${baseUrl}/widget-loader.js" 
  data-cliente-id="${config.cliente_id}"
  data-position="${config.widgetPosition || "bottom-right"}"
  async>
</script>`

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(integrationCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error("Error copiando al portapapeles:", err)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">Código de Integración</CardTitle>
        <CardDescription>
          Copia este código y pégalo en tu sitio web antes del cierre de la etiqueta &lt;/body&gt;
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <Textarea value={integrationCode} readOnly className="font-mono text-sm min-h-[120px] resize-none" />
          <Button size="sm" variant="outline" className="absolute top-2 right-2" onClick={copyToClipboard}>
            {copied ? (
              <>
                <Check className="w-4 h-4 mr-1" />
                Copiado
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 mr-1" />
                Copiar
              </>
            )}
          </Button>
        </div>

        <div className="bg-blue-50 p-4 rounded-lg">
          <h4 className="font-medium text-blue-900 mb-2">Instrucciones:</h4>
          <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
            <li>Copia el código de arriba</li>
            <li>Pégalo en tu sitio web antes del cierre de &lt;/body&gt;</li>
            <li>El widget aparecerá automáticamente en la posición configurada</li>
          </ol>
        </div>

        <div className="bg-yellow-50 p-4 rounded-lg">
          <h4 className="font-medium text-yellow-900 mb-2">Vista Previa:</h4>
          <p className="text-sm text-yellow-800 mb-2">Puedes ver cómo se verá el widget en:</p>
          <a
            href={`${baseUrl}/widget?clienteId=${config.cliente_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 underline text-sm"
          >
            {baseUrl}/widget?clienteId={config.cliente_id}
          </a>
        </div>
      </CardContent>
    </Card>
  )
}
