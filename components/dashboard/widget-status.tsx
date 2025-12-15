"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CheckCircle, Loader2, AlertCircle } from "lucide-react"
import type { WhatsAppConfig } from "@/lib/types"

interface WidgetStatusProps {
  config: WhatsAppConfig
}

export function WidgetStatus({ config }: WidgetStatusProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [widgetStatus, setWidgetStatus] = useState<"loading" | "active" | "inactive">("loading")

  useEffect(() => {
    // Simular verificación del estado del widget
    const checkWidgetStatus = () => {
      setTimeout(() => {
        if (config.widgetEnabled !== false && config.active) {
          setWidgetStatus("active")
        } else {
          setWidgetStatus("inactive")
        }
        setIsLoading(false)
      }, 1000)
    }

    checkWidgetStatus()
  }, [config.widgetEnabled, config.active])

  const getStatusIcon = () => {
    if (isLoading) return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
    if (widgetStatus === "active") return <CheckCircle className="h-5 w-5 text-green-500" />
    return <AlertCircle className="h-5 w-5 text-red-500" />
  }

  const getStatusBadge = () => {
    if (isLoading) return <Badge variant="secondary">Cargando...</Badge>
    if (widgetStatus === "active") return <Badge variant="default">Activo</Badge>
    return <Badge variant="destructive">Inactivo</Badge>
  }

  const getStatusMessage = () => {
    if (isLoading) return "Cargando el widget de chat..."
    if (widgetStatus === "active") return "El widget está funcionando correctamente y listo para recibir mensajes."
    return "El widget no está disponible. Verifica la configuración."
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Estado del Widget
          {getStatusIcon()}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 mb-2">
          {getStatusBadge()}
          <span className="text-sm text-gray-600">{getStatusMessage()}</span>
        </div>

        {!isLoading && (
          <div className="text-xs text-gray-500 space-y-1">
            <div>Configuración: {config.active ? "Activa" : "Inactiva"}</div>
            <div>Widget: {config.widgetEnabled !== false ? "Habilitado" : "Deshabilitado"}</div>
            <div>Cliente ID: {config.cliente_id || "No configurado"}</div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
