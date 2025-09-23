"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { LineChart, BarChart } from "@/components/ui/charts"

export function PerformanceMetrics() {
  const [metrics, setMetrics] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState("day")

  useEffect(() => {
    let isMounted = true

    const fetchMetrics = async () => {
      try {
        const response = await fetch(`/api/dashboard/metrics?period=${period}`)
        if (response.ok && isMounted) {
          const data = await response.json()
          setMetrics(data)
        }
      } catch (error) {
        if (isMounted) {
          console.error("Error al cargar métricas:", error)
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    fetchMetrics()

    // Actualizar cada minuto
    const interval = setInterval(() => {
      if (isMounted) {
        fetchMetrics()
      }
    }, 60000)

    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [period])

  if (loading) {
    return <div className="p-4 border rounded-md">Cargando métricas de rendimiento...</div>
  }

  if (!metrics) {
    return (
      <div className="p-4 border rounded-md text-center">
        No se pudieron cargar las métricas. Por favor, intenta de nuevo más tarde.
      </div>
    )
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Métricas de Rendimiento</CardTitle>
        <CardDescription>Monitoreo del rendimiento del sistema en tiempo real</CardDescription>
        <Tabs value={period} onValueChange={setPeriod}>
          <TabsList>
            <TabsTrigger value="hour">Última Hora</TabsTrigger>
            <TabsTrigger value="day">Último Día</TabsTrigger>
            <TabsTrigger value="week">Última Semana</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Mensajes Procesados</CardTitle>
            </CardHeader>
            <CardContent>
              <LineChart data={metrics.messagesProcessed} xKey="time" yKey="count" height={200} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tiempo de Respuesta (ms)</CardTitle>
            </CardHeader>
            <CardContent>
              <LineChart data={metrics.responseTime} xKey="time" yKey="value" height={200} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Errores</CardTitle>
            </CardHeader>
            <CardContent>
              <BarChart data={metrics.errors} xKey="category" yKey="count" height={200} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tasa de Éxito</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center h-[200px]">
                <div className="text-5xl font-bold">{metrics.successRate.toFixed(1)}%</div>
                <div className="text-sm text-muted-foreground mt-2">Basado en {metrics.totalRequests} solicitudes</div>
              </div>
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  )
}
