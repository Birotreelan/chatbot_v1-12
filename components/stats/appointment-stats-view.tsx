"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { CheckCircle2, XCircle, Calendar, Clock, TrendingUp, TrendingDown, Send } from "lucide-react"
import type { ClientAppointmentStats } from "@/lib/types"
import { AppointmentChart } from "./appointment-chart"
import { ResponseTimeChart } from "./response-time-chart"

interface AppointmentStatsViewProps {
  clienteId: string
  clientName: string
}

export function AppointmentStatsView({ clienteId, clientName }: AppointmentStatsViewProps) {
  const [stats, setStats] = useState<ClientAppointmentStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchStats() {
      try {
        setLoading(true)
        setError(null)

        const response = await fetch(`/api/stats/${clienteId}`)
        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || "Error al cargar estadísticas")
        }

        if (data.success) {
          setStats(data.data)
        } else {
          throw new Error(data.error || "Error desconocido")
        }
      } catch (err) {
        console.error("Error fetching stats:", err)
        setError(err instanceof Error ? err.message : "Error al cargar estadísticas")
      } finally {
        setLoading(false)
      }
    }

    fetchStats()

    // Actualizar cada 30 segundos
    const interval = setInterval(fetchStats, 30000)
    return () => clearInterval(interval)
  }, [clienteId])

  if (loading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-32" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16 mb-2" />
                <Skeleton className="h-3 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="container mx-auto p-6">
        <Alert>
          <AlertDescription>No hay estadísticas disponibles para este cliente.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">{clientName}</h1>
        <p className="text-muted-foreground">Estadísticas de gestión de turnos</p>
      </div>

      {/* Métricas principales */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Plantillas Enviadas</CardTitle>
            <Send className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalTemplatesSent}</div>
            <p className="text-xs text-muted-foreground">Total de recordatorios enviados</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Turnos Confirmados</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats.totalConfirmed}</div>
            <p className="text-xs text-muted-foreground">
              {stats.confirmationRate.toFixed(1)}% de tasa de confirmación
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Turnos Cancelados</CardTitle>
            <XCircle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats.totalCancelled}</div>
            <p className="text-xs text-muted-foreground">{stats.cancellationRate.toFixed(1)}% de tasa de cancelación</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Reprogramaciones</CardTitle>
            <Calendar className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{stats.totalRescheduled}</div>
            <p className="text-xs text-muted-foreground">Solicitudes de reagendado</p>
          </CardContent>
        </Card>
      </div>

      {/* Tasas de conversión */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Tasa de Respuesta</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <div className="text-3xl font-bold">{stats.responseRate.toFixed(1)}%</div>
              {stats.responseRate >= 70 ? (
                <TrendingUp className="h-5 w-5 text-green-600" />
              ) : (
                <TrendingDown className="h-5 w-5 text-red-600" />
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Porcentaje de usuarios que respondieron a las plantillas
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Tiempo Promedio de Respuesta</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <div className="text-3xl font-bold">
                {stats.avgResponseTime < 60
                  ? `${Math.round(stats.avgResponseTime)}m`
                  : `${(stats.avgResponseTime / 60).toFixed(1)}h`}
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Tiempo promedio hasta recibir respuesta</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Eficiencia de Confirmación</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <div className="text-3xl font-bold">
                {stats.avgConfirmationTime < 60
                  ? `${Math.round(stats.avgConfirmationTime)}m`
                  : `${(stats.avgConfirmationTime / 60).toFixed(1)}h`}
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Tiempo promedio hasta confirmación</p>
          </CardContent>
        </Card>
      </div>

      {/* Gráficos */}
      <div className="grid gap-4 md:grid-cols-2">
        <AppointmentChart stats={stats} />
        <ResponseTimeChart stats={stats} />
      </div>

      {/* Footer con última actualización */}
      <div className="text-center text-sm text-muted-foreground">
        Última actualización: {new Date(stats.lastUpdated).toLocaleString("es-AR")}
      </div>
    </div>
  )
}
