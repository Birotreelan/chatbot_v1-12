"use client"

import { useState, useEffect, useCallback } from "react"
import type { ClientAppointmentStats } from "@/lib/types"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Loader2, RefreshCw, Send, CheckCircle, XCircle, CalendarClock, Clock, TrendingUp, MessageCircle, PlusCircle } from "lucide-react"
import { DateRangeFilter } from "./date-range-filter"

interface AppointmentStatsDetailProps {
  clienteId: string
  displayName: string
}

export function AppointmentStatsDetail({ clienteId, displayName }: AppointmentStatsDetailProps) {
  const [stats, setStats] = useState<ClientAppointmentStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const todayUTC = new Date()
  const today = new Date(Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth(), todayUTC.getUTCDate()))
    .toISOString()
    .split("T")[0]
  const [startDate, setStartDate] = useState<string | null>(today)
  const [endDate, setEndDate] = useState<string | null>(today)

  const loadStats = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      params.set("clienteId", clienteId)
      if (startDate) params.set("startDate", startDate)
      if (endDate) params.set("endDate", endDate)

      const response = await fetch(`/api/appointment-stats?${params.toString()}`)
      if (response.ok) {
        const data = await response.json()
        setStats(data)
      }
    } catch (error) {
      console.error("Error cargando estadísticas:", error)
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

  if (loading) {
    return (
      <div className="space-y-4">
        <DateRangeFilter onFilterChange={handleFilterChange} />
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  const formatTime = (minutes: number) => {
    if (minutes < 60) {
      return `${Math.round(minutes)} min`
    }
    const hours = Math.floor(minutes / 60)
    const mins = Math.round(minutes % 60)
    return `${hours}h ${mins}m`
  }

  return (
    <div className="space-y-6">
      <DateRangeFilter onFilterChange={handleFilterChange} />

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">{displayName}</h2>
          <p className="text-sm text-muted-foreground">
            Última actualización:{" "}
            {stats?.lastUpdated ? new Date(stats.lastUpdated).toLocaleString("es-AR") : "Sin datos"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Recordatorios Enviados</CardTitle>
            <Send className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalTemplatesSent || 0}</div>
            <p className="text-xs text-muted-foreground">Total de plantillas enviadas</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Confirmados</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats?.totalConfirmed || 0}</div>
            <p className="text-xs text-muted-foreground">Tasa: {stats?.confirmationRate?.toFixed(1) || 0}%</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cancelados</CardTitle>
            <XCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats?.totalCancelled || 0}</div>
            <p className="text-xs text-muted-foreground">Tasa: {stats?.cancellationRate?.toFixed(1) || 0}%</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Reagendados</CardTitle>
            <CalendarClock className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{stats?.totalRescheduled || 0}</div>
            <p className="text-xs text-muted-foreground">
              Tasa: {stats?.totalCancelled && stats.totalCancelled > 0
                ? (((stats?.totalRescheduled || 0) / stats.totalCancelled) * 100).toFixed(1)
                : 0}%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Turnos Nuevos</CardTitle>
            <PlusCircle className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{stats?.totalNewAppointments || 0}</div>
            <p className="text-xs text-muted-foreground">Agendados por el paciente</p>
          </CardContent>
        </Card>
      </div>

      {/* Nueva sección: Conversaciones User-Initiated */}
      <Card className="border-blue-200 bg-blue-50/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-blue-600" />
            Conversaciones Iniciadas por Pacientes
          </CardTitle>
          <CardDescription>
            Conversaciones que no tienen un recordatorio previo o están fuera de la ventana de 24 horas. Estas generan costos adicionales en WhatsApp Business.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="text-center p-4 bg-white rounded-lg border">
              <div className="text-3xl font-bold text-blue-600">{stats?.totalUserInitiated || 0}</div>
              <div className="text-sm text-muted-foreground mt-1">Total conversaciones</div>
            </div>
            <div className="text-center p-4 bg-white rounded-lg border">
              <div className="text-3xl font-bold text-blue-600">{stats?.userInitiatedRate?.toFixed(1) || 0}%</div>
              <div className="text-sm text-muted-foreground mt-1">Tasa user-initiated</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tiempo Promedio de Respuesta</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.avgResponseTime ? formatTime(stats.avgResponseTime) : "—"}</div>
            <p className="text-xs text-muted-foreground">Desde envío de recordatorio hasta respuesta</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tiempo hasta Confirmación</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.avgConfirmationTime ? formatTime(stats.avgConfirmationTime) : "—"}
            </div>
            <p className="text-xs text-muted-foreground">Promedio de respuesta para confirmar</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tiempo hasta Cancelación</CardTitle>
            <XCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.avgCancellationTime ? formatTime(stats.avgCancellationTime) : "—"}
            </div>
            <p className="text-xs text-muted-foreground">Promedio de respuesta para cancelar</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Tasa de Respuesta General
          </CardTitle>
          <CardDescription>
            Porcentaje de pacientes que respondieron al recordatorio (confirmando o cancelando)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="text-4xl font-bold">{stats?.responseRate?.toFixed(1) || 0}%</div>
            <div className="flex-1">
              <div className="h-4 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-500"
                  style={{ width: `${Math.min(stats?.responseRate || 0, 100)}%` }}
                />
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
            <div className="text-center p-2 bg-green-50 rounded-lg">
              <div className="font-semibold text-green-700">{stats?.confirmationRate?.toFixed(1) || 0}%</div>
              <div className="text-green-600">Confirmaciones</div>
            </div>
            <div className="text-center p-2 bg-red-50 rounded-lg">
              <div className="font-semibold text-red-700">{stats?.cancellationRate?.toFixed(1) || 0}%</div>
              <div className="text-red-600">Cancelaciones</div>
            </div>
            <div className="text-center p-2 bg-muted rounded-lg">
              <div className="font-semibold text-muted-foreground">
                {(100 - (stats?.responseRate || 0)).toFixed(1)}%
              </div>
              <div className="text-muted-foreground">Sin respuesta</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {(!stats || (stats.totalTemplatesSent === 0 && stats.totalConfirmed === 0 && stats.totalUserInitiated === 0)) && (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">Aún no hay datos de estadísticas para este cliente.</p>
            <p className="text-sm text-muted-foreground mt-2">
              Las estadísticas se actualizarán automáticamente cuando:
            </p>
            <ul className="text-sm text-muted-foreground mt-2 space-y-1">
              <li>• Se reciban recordatorios de turnos a través del proxylistener</li>
              <li>• Los pacientes confirmen sus turnos presionando el botón de confirmación</li>
              <li>• Los pacientes cancelen sus turnos presionando el botón de cancelación</li>
              <li>• Se reagenden turnos mediante la función de reserva (set_turno)</li>
              <li>• Los pacientes inicien conversaciones sin un recordatorio previo (user-initiated)</li>
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
