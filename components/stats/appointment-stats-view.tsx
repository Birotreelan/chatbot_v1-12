"use client"

import { useState, useEffect, useCallback } from "react"
import type { ClientAppointmentStats } from "@/lib/types"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2, RefreshCw, Send, CheckCircle, XCircle, CalendarClock, MessageCircle, PlusCircle, ArrowRight } from "lucide-react"
import { DateRangeFilter } from "@/components/dashboard/date-range-filter"

interface AppointmentStatsViewProps {
  clienteId: string
  clientName: string
  initialStats: ClientAppointmentStats | null
}

export function AppointmentStatsView({ clienteId, clientName, initialStats }: AppointmentStatsViewProps) {
  const [stats, setStats] = useState<ClientAppointmentStats | null>(initialStats)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const todayUTC = new Date()
  const today = new Date(Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth(), todayUTC.getUTCDate()))
    .toISOString()
    .split("T")[0]
  const [startDate, setStartDate] = useState<string | null>(today)
  const [endDate, setEndDate] = useState<string | null>(today)

  const loadStats = useCallback(async () => {
    try {
      setError(null)
      const params = new URLSearchParams()
      params.set("clienteId", clienteId)
      if (startDate) params.set("startDate", startDate)
      if (endDate) params.set("endDate", endDate)

      const response = await fetch(`/api/appointment-stats?${params.toString()}`)
      if (response.ok) {
        const data = await response.json()
        setStats(data)
      } else {
        throw new Error(`Error ${response.status}: ${response.statusText}`)
      }
    } catch (err) {
      console.error("Error cargando estadísticas:", err)
      setError(err instanceof Error ? err.message : "Error al cargar estadísticas")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [clienteId, startDate, endDate])

  useEffect(() => {
    setLoading(true)
    loadStats()
  }, [clienteId, loadStats])

  const handleRefresh = () => {
    setRefreshing(true)
    loadStats()
  }

  const handleFilterChange = (newStartDate: string | null, newEndDate: string | null) => {
    setStartDate(newStartDate)
    setEndDate(newEndDate)
    setLoading(true)
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <div className="space-y-2 mb-6">
          <h1 className="text-3xl font-bold tracking-tight">{clientName}</h1>
          <p className="text-muted-foreground">Estadísticas de gestión de turnos</p>
        </div>
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    )
  }

  // Calcular tasa de conversión de cancelados a reagendados
  const rescheduledFromCancelledRate = stats?.totalCancelled && stats.totalCancelled > 0
    ? ((stats?.totalRescheduled || 0) / stats.totalCancelled) * 100
    : 0

  // Calcular tasa de conversión de conversaciones iniciadas a nuevos turnos
  const newAppointmentConversionRate = stats?.totalUserInitiated && stats.totalUserInitiated > 0
    ? ((stats?.totalNewAppointments || 0) / stats.totalUserInitiated) * 100
    : 0

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">{clientName}</h1>
        <p className="text-muted-foreground">Estadísticas de gestión de turnos</p>
      </div>

      {/* Filtro de fechas */}
      <DateRangeFilter onFilterChange={handleFilterChange} />

      {/* Controles */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Última actualización:{" "}
          {stats?.lastUpdated ? new Date(stats.lastUpdated).toLocaleString("es-AR") : "Sin datos"}
        </p>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing || loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !stats ? (
        <Alert>
          <AlertDescription>
            No hay estadísticas disponibles aún. Las estadísticas comenzarán a aparecer cuando se envíen plantillas y
            los usuarios respondan.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {/* Fila 1: Recordatorios Enviados y Confirmados */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Recordatorios Enviados</CardTitle>
                <Send className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats?.totalTemplatesSent || 0}</div>
                <p className="text-xs text-muted-foreground mt-1">Total de plantillas enviadas</p>
              </CardContent>
            </Card>

            <Card className="border-green-200 bg-green-50/30">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Recordatorios Confirmados</CardTitle>
                <CheckCircle className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-green-600">{stats?.totalConfirmed || 0}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Tasa de confirmación: <span className="font-semibold text-green-600">{stats?.confirmationRate?.toFixed(1) || 0}%</span>
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Fila 2: Cancelados y Reagendados */}
          <Card className="border-amber-200 bg-amber-50/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-red-500" />
                Cancelaciones y Reagendamientos
              </CardTitle>
              <CardDescription>
                Seguimiento de cancelaciones y su conversión a nuevos turnos reagendados
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 md:grid-cols-3">
                {/* Cancelados */}
                <div className="text-center p-4 bg-white rounded-lg border border-red-100">
                  <XCircle className="h-6 w-6 text-red-500 mx-auto mb-2" />
                  <div className="text-3xl font-bold text-red-600">{stats?.totalCancelled || 0}</div>
                  <div className="text-sm text-muted-foreground mt-1">Cancelados</div>
                  <div className="text-xs text-red-600 mt-1">
                    {stats?.cancellationRate?.toFixed(1) || 0}% del total
                  </div>
                </div>

                {/* Flecha de conversión */}
                <div className="flex flex-col items-center justify-center">
                  <ArrowRight className="h-8 w-8 text-amber-500 hidden md:block" />
                  <div className="text-center mt-2">
                    <div className="text-2xl font-bold text-amber-600">
                      {rescheduledFromCancelledRate.toFixed(1)}%
                    </div>
                    <div className="text-xs text-muted-foreground">Tasa de conversión</div>
                  </div>
                </div>

                {/* Reagendados */}
                <div className="text-center p-4 bg-white rounded-lg border border-amber-100">
                  <CalendarClock className="h-6 w-6 text-amber-500 mx-auto mb-2" />
                  <div className="text-3xl font-bold text-amber-600">{stats?.totalRescheduled || 0}</div>
                  <div className="text-sm text-muted-foreground mt-1">Reagendados</div>
                  <div className="text-xs text-amber-600 mt-1">
                    Turnos recuperados
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Fila 3: Solicitud de Nuevos Turnos */}
          <Card className="border-blue-200 bg-blue-50/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5 text-blue-600" />
                Solicitud de Nuevos Turnos
              </CardTitle>
              <CardDescription>
                Conversaciones iniciadas por pacientes y su conversión a nuevos turnos agendados
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 md:grid-cols-4">
                {/* Conversaciones iniciadas */}
                <div className="text-center p-4 bg-white rounded-lg border border-blue-100">
                  <MessageCircle className="h-6 w-6 text-blue-500 mx-auto mb-2" />
                  <div className="text-3xl font-bold text-blue-600">{stats?.totalUserInitiated || 0}</div>
                  <div className="text-sm text-muted-foreground mt-1">Conversaciones iniciadas</div>
                  <div className="text-xs text-blue-600 mt-1">
                    Por pacientes
                  </div>
                </div>

                {/* Tasa user-initiated */}
                <div className="text-center p-4 bg-white rounded-lg border border-blue-100">
                  <div className="text-3xl font-bold text-blue-600">{stats?.userInitiatedRate?.toFixed(1) || 0}%</div>
                  <div className="text-sm text-muted-foreground mt-1">Tasa user-initiated</div>
                  <div className="text-xs text-blue-600 mt-1">
                    Del total de conversaciones
                  </div>
                </div>

                {/* Flecha de conversión */}
                <div className="flex flex-col items-center justify-center">
                  <ArrowRight className="h-8 w-8 text-blue-500 hidden md:block" />
                  <div className="text-center mt-2">
                    <div className="text-2xl font-bold text-blue-600">
                      {newAppointmentConversionRate.toFixed(1)}%
                    </div>
                    <div className="text-xs text-muted-foreground">Tasa de conversión</div>
                  </div>
                </div>

                {/* Nuevos turnos */}
                <div className="text-center p-4 bg-white rounded-lg border border-green-100">
                  <PlusCircle className="h-6 w-6 text-green-500 mx-auto mb-2" />
                  <div className="text-3xl font-bold text-green-600">{stats?.totalNewAppointments || 0}</div>
                  <div className="text-sm text-muted-foreground mt-1">Nuevos turnos</div>
                  <div className="text-xs text-green-600 mt-1">
                    Agendados exitosamente
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Mensaje cuando no hay datos */}
          {(stats.totalTemplatesSent === 0 && stats.totalConfirmed === 0 && stats.totalUserInitiated === 0) && (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center">
                <p className="text-muted-foreground">Aún no hay datos de estadísticas para este período.</p>
                <p className="text-sm text-muted-foreground mt-2">
                  Prueba seleccionando un rango de fechas diferente o espera a que se generen nuevos datos.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
