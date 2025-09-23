"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

interface MonitoringData {
  totalMessages: number
  messagesProcessed: number
  errorRate: number
  averageResponseTime: number
  activeThreads: number
  queueSize: number
  systemHealth: "healthy" | "warning" | "critical"
  lastUpdated: string
}

export function MonitoringStats() {
  const [data, setData] = useState<MonitoringData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchMonitoringData() {
      try {
        const response = await fetch("/api/dashboard/monitoring")
        if (response.ok) {
          const monitoringData = await response.json()
          setData(monitoringData)
        }
      } catch (error) {
        console.error("Error al cargar datos de monitoreo:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchMonitoringData()

    // Actualizar cada 30 segundos
    const interval = setInterval(fetchMonitoringData, 30000)
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return <div className="p-4 border rounded-md">Cargando estadísticas de monitoreo...</div>
  }

  if (!data) {
    return (
      <div className="p-4 border rounded-md text-center">
        No se pudieron cargar las estadísticas de monitoreo. Por favor, intenta de nuevo más tarde.
      </div>
    )
  }

  const getHealthBadgeVariant = (health: string) => {
    switch (health) {
      case "healthy":
        return "default"
      case "warning":
        return "secondary"
      case "critical":
        return "destructive"
      default:
        return "outline"
    }
  }

  const getHealthColor = (health: string) => {
    switch (health) {
      case "healthy":
        return "text-green-600"
      case "warning":
        return "text-yellow-600"
      case "critical":
        return "text-red-600"
      default:
        return "text-gray-600"
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Estado del Sistema</CardTitle>
          <Badge variant={getHealthBadgeVariant(data.systemHealth)}>
            {data.systemHealth === "healthy" && "Saludable"}
            {data.systemHealth === "warning" && "Advertencia"}
            {data.systemHealth === "critical" && "Crítico"}
          </Badge>
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${getHealthColor(data.systemHealth)}`}>
            {data.systemHealth === "healthy" && "✓"}
            {data.systemHealth === "warning" && "⚠"}
            {data.systemHealth === "critical" && "✗"}
          </div>
          <p className="text-xs text-muted-foreground">
            Actualizado: {new Date(data.lastUpdated).toLocaleTimeString()}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Mensajes Totales</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{data.totalMessages.toLocaleString()}</div>
          <p className="text-xs text-muted-foreground">{data.messagesProcessed.toLocaleString()} procesados</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Tasa de Errores</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{data.errorRate.toFixed(2)}%</div>
          <p className="text-xs text-muted-foreground">
            {data.errorRate < 1 ? "Excelente" : data.errorRate < 5 ? "Bueno" : "Necesita atención"}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Tiempo de Respuesta</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{data.averageResponseTime.toFixed(1)}s</div>
          <p className="text-xs text-muted-foreground">{data.activeThreads} conversaciones activas</p>
        </CardContent>
      </Card>
    </div>
  )
}
