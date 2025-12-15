"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Copy, ExternalLink, Eye } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import type { WhatsAppConfig } from "@/lib/types"

interface WidgetUrlsProps {
  config: WhatsAppConfig
}

export function WidgetUrls({ config }: WidgetUrlsProps) {
  const [baseUrl, setBaseUrl] = useState("")
  const { toast } = useToast()

  useEffect(() => {
    // Solo establecer la URL base en el cliente
    if (typeof window !== "undefined") {
      setBaseUrl(window.location.origin)
    }
  }, [])

  const copyToClipboard = async (text: string) => {
    if (typeof window !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text)
        toast({
          title: "Copiado",
          description: "El enlace se ha copiado al portapapeles.",
        })
      } catch (err) {
        console.error("Error al copiar:", err)
        toast({
          title: "Error",
          description: "No se pudo copiar el enlace.",
          variant: "destructive",
        })
      }
    }
  }

  const openInNewTab = (url: string) => {
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer")
    }
  }

  if (!baseUrl) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse">
          <Label>URL del Widget</Label>
          <div className="h-10 bg-gray-200 rounded mt-1"></div>
        </div>
        <div className="animate-pulse">
          <Label>Página de Demostración</Label>
          <div className="h-10 bg-gray-200 rounded mt-1"></div>
        </div>
      </div>
    )
  }

  const widgetUrl = `${baseUrl}/widget/${config.cliente_id || config.id}`
  const demoUrl = `${baseUrl}/chat/${config.id}`

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="widget-url">URL del Widget</Label>
        <div className="flex gap-2 mt-1">
          <Input id="widget-url" type="text" value={widgetUrl} readOnly className="bg-gray-50" />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => copyToClipboard(widgetUrl)}
            title="Copiar URL"
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => openInNewTab(widgetUrl)}
            title="Abrir en nueva pestaña"
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div>
        <Label htmlFor="demo-url">Página de Demostración</Label>
        <div className="flex gap-2 mt-1">
          <Input id="demo-url" type="text" value={demoUrl} readOnly className="bg-gray-50" />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => copyToClipboard(demoUrl)}
            title="Copiar URL"
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => openInNewTab(demoUrl)}
            title="Ver demostración"
          >
            <Eye className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
