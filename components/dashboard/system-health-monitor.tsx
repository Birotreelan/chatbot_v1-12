"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { RefreshCw, Activity, AlertTriangle, CheckCircle, XCircle } from "lucide-react"

interface SystemHealth {
  timestamp: string
  openaiStatus: "healthy" | "degraded" | "down"
  whatsappStatus: "healthy" | "degraded" | "down"
  redisStatus: "healthy" | "degraded" | "down"
  overallStatus: "healthy" | "degraded" | "down"
  metrics: {
    totalMessages: number
    successfulMessages: number
    failedMessages: number
    averageResponseTime: number
    errorRate: number
  }
  errors: Array<{
    timestamp: string
    type: string
    message: string
    count: number
  }>
  recommendations: string[]
}

interface DiagnosticEvent {
  timestamp: string
  type: "error" | "warning" | "info" | "success"
  component: string
  message: string
  data?: any
}

interface SystemHealthData {
  health: SystemHealth
  recentEvents: DiagnosticEvent[]
  errorPatterns: Array<{ pattern: string; count: number }>
  timestamp: string
}

export function SystemHealthMonitor() {
  const [healthData, setHealthData] = useState<SystemHealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const fetchHealthData = async () => {
    try {
      setLoading(true)
      const response = await fetch("/api/system-health")
      if (!response.ok) {
        throw new Error("Error obteniendo datos de salud")
      }
      const data = await response.json()
      setHealthData(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido")
    } finally {
      setLoading(false)
    }
  }

  const runHealthCheck = async () => {
    try {
      await fetch("/api/system-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run-health-check" }),
      })
      // Refrescar datos después del chequeo
      setTimeout(fetchHealthData, 1000)
    } catch (err) {
      console.error("Error ejecutando chequeo de salud:", err)
    }
  }

  useEffect(() => {
    fetchHealthData()
  }, [])

  useEffect(() => {
    if (!autoRefresh) return

    const interval = setInterval(fetchHealthData, 30000) // Refrescar cada 30 segundos
    return () => clearInterval(interval)
  }, [autoRefresh])

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "healthy":
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case "degraded":
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />
      case "down":
        return <XCircle className="h-4 w-4 text-red-500" />
      default:
        return <Activity className="h-4 w-4 text-gray-500" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "healthy":
        return "bg-green-100 text-green-800"
      case "degraded":
        return "bg-yellow-100 text-yellow-800"
      case "down":
        return "bg-red-100 text-red-800"
      default:
        return "bg-gray-100 text-gray-800"
    }
  }

  const getEventTypeIcon = (type: string) => {
    switch (type) {
      case "error":
        return "🔴"
      case "warning":
        return "🟡"
      case "success":
        return "🟢"
      case "info":
        return "🔵"
      default:
        return "⚪"
    }
  }

  if (loading && !healthData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Monitor de Salud del Sistema
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center p-8">
            <RefreshCw className="h-8 w-8 animate-spin" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Monitor de Salud del Sistema
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button onClick={fetchHealthData} className="mt-4">
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!healthData) return null

  return (
    <div className="space-y-6">
      {/* Header con controles */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Monitor de Salud del Sistema
              </CardTitle>
              <CardDescription>Última actualización: {new Date(healthData.timestamp).toLocaleString()}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setAutoRefresh(!autoRefresh)}>
                {autoRefresh ? "Pausar" : "Reanudar"} Auto-refresh
              </Button>
              <Button variant="outline" size="sm" onClick={runHealthCheck}>
                <Activity className="h-4 w-4 mr-2" />
                Chequeo Manual
              </Button>
              <Button variant="outline" size="sm" onClick={fetchHealthData} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                Refrescar
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Estado general */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {getStatusIcon(healthData.health.overallStatus)}
            Estado General del Sistema
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="text-center">
              <Badge className={getStatusColor(healthData.health.overallStatus)}>
                {healthData.health.overallStatus.toUpperCase()}
              </Badge>
              <p className="text-sm text-muted-foreground mt-1">Estado General</p>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{healthData.health.metrics.totalMessages}</div>
              <p className="text-sm text-muted-foreground">Mensajes Totales</p>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{healthData.health.metrics.successfulMessages}</div>
              <p className="text-sm text-muted-foreground">Exitosos</p>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">{healthData.health.metrics.failedMessages}</div>
              <p className="text-sm text-muted-foreground">Fallidos</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Estado de componentes */}
      <Card>
        <CardHeader>
          <CardTitle>Estado de Componentes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex items-center gap-2">
                {getStatusIcon(healthData.health.openaiStatus)}
                <span className="font-medium">OpenAI API</span>
              </div>
              <Badge className={getStatusColor(healthData.health.openaiStatus)}>{healthData.health.openaiStatus}</Badge>
            </div>
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex items-center gap-2">
                {getStatusIcon(healthData.health.whatsappStatus)}
                <span className="font-medium">WhatsApp API</span>
              </div>
              <Badge className={getStatusColor(healthData.health.whatsappStatus)}>
                {healthData.health.whatsappStatus}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex items-center gap-2">
                {getStatusIcon(healthData.health.redisStatus)}
                <span className="font-medium">Redis</span>
              </div>
              <Badge className={getStatusColor(healthData.health.redisStatus)}>{healthData.health.redisStatus}</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recomendaciones */}
      {healthData.health.recommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recomendaciones</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {healthData.health.recommendations.map((recommendation, index) => (
                <Alert key={index}>
                  <AlertDescription>{recommendation}</AlertDescription>
                </Alert>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs para eventos y patrones */}
      <Tabs defaultValue="events" className="w-full">
        <TabsList>
          <TabsTrigger value="events">Eventos Recientes</TabsTrigger>
          <TabsTrigger value="patterns">Patrones de Error</TabsTrigger>
          <TabsTrigger value="errors">Errores Resumidos</TabsTrigger>
        </TabsList>

        <TabsContent value="events">
          <Card>
            <CardHeader>
              <CardTitle>Eventos Recientes (Últimos 50)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {healthData.recentEvents.map((event, index) => (
                  <div key={index} className="flex items-start gap-3 p-3 border rounded-lg">
                    <span className="text-lg">{getEventTypeIcon(event.type)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{event.component}</Badge>
                        <span className="text-sm text-muted-foreground">
                          {new Date(event.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-sm mt-1">{event.message}</p>
                      {event.data && (
                        <details className="mt-2">
                          <summary className="text-xs text-muted-foreground cursor-pointer">Ver detalles</summary>
                          <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-x-auto">
                            {JSON.stringify(event.data, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="patterns">
          <Card>
            <CardHeader>
              <CardTitle>Patrones de Error Más Frecuentes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {healthData.errorPatterns.map((pattern, index) => (
                  <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                    <span className="text-sm font-mono">{pattern.pattern}</span>
                    <Badge variant="destructive">{pattern.count} veces</Badge>
                  </div>
                ))}
                {healthData.errorPatterns.length === 0 && (
                  <p className="text-center text-muted-foreground py-8">No hay patrones de error recurrentes</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="errors">
          <Card>
            <CardHeader>
              <CardTitle>Errores Resumidos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {healthData.health.errors.map((error, index) => (
                  <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <div className="font-medium">{error.type}</div>
                      <div className="text-sm text-muted-foreground">{error.message}</div>
                      <div className="text-xs text-muted-foreground">{new Date(error.timestamp).toLocaleString()}</div>
                    </div>
                    <Badge variant="destructive">{error.count}</Badge>
                  </div>
                ))}
                {healthData.health.errors.length === 0 && (
                  <p className="text-center text-muted-foreground py-8">No hay errores recientes</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
