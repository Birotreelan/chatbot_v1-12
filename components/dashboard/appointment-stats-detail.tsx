"use client"

import { useState, useEffect, useCallback } from "react"
import type { ClientAppointmentStats } from "@/lib/types"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Loader2, RefreshCw, Send, CheckCircle, XCircle, CalendarClock, MessageCircle, PlusCircle, Clock, TrendingUp } from "lucide-react"
import { DateRangeFilter } from "./date-range-filter"

interface AppointmentStatsDetailProps {
  clienteId: string
  displayName: string
}

// Estadísticas de turnos - v8
export function AppointmentStatsDetail({ clienteId, displayName }: AppointmentStatsDetailProps) {
  const [stats, setStats] = useState<ClientAppointmentStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [mensajesPagados, setMensajesPagados] = useState<number>(0)
  const [loadingMensajes, setLoadingMensajes] = useState(true)
  const todayUTC = new Date()
  const today = new Date(Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth(), todayUTC.getUTCDate()))
    .toISOString()
    .split("T")[0]
  const [startDate, setStartDate] = useState<string | null>(today)
  const [endDate, setEndDate] = useState<string | null>(today)

  // Fetch mensajes_pagados from the API route
  const loadMensajesPagados = useCallback(async () => {
    if (!clienteId || !startDate || !endDate) {
      setMensajesPagados(0)
      setLoadingMensajes(false)
      return
    }

    setLoadingMensajes(true)
    try {
      const url = `/api/appointment-stats/mensajes-pagados?cliente_id=${encodeURIComponent(clienteId)}&fecha_inicio=${startDate}&fecha_fin=${endDate}`
      const response = await fetch(url)
      
      if (response.ok) {
        const data = await response.json()
        setMensajesPagados(data.mensajes_pagados || 0)
      } else {
        console.error("[APPOINTMENT_STATS] Error fetching mensajes_pagados:", response.status)
        setMensajesPagados(0)
      }
    } catch (error) {
      console.error("[APPOINTMENT_STATS] Error fetching mensajes_pagados:", error)
      setMensajesPagados(0)
    } finally {
      setLoadingMensajes(false)
    }
  }, [clienteId, startDate, endDate])

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
    loadMensajesPagados()
  }, [clienteId, loadStats, loadMensajesPagados])

  const handleRefresh = () => {
    setRefreshing(true)
    loadStats()
    loadMensajesPagados()
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

  // Calcular tasa de conversión de conversaciones iniciadas a nuevos turnos
  const newAppointmentConversionRate = stats?.totalUserInitiated && stats.totalUserInitiated > 0
    ? ((stats?.totalNewAppointments || 0) / stats.totalUserInitiated) * 100
    : 0

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

      {/* Fila 1: Recordatorios - Enviados, Confirmados, Cancelados, Sin respuesta */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Recordatorios Enviados</CardTitle>
            <Send className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {loadingMensajes ? (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              ) : (
                mensajesPagados
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Total de mensajes pagados</p>
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

        <Card className="border-red-200 bg-red-50/30">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Recordatorios Cancelados</CardTitle>
            <XCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">{stats?.totalCancelled || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Tasa de cancelación: <span className="font-semibold text-red-600">{stats?.cancellationRate?.toFixed(1) || 0}%</span>
            </p>
          </CardContent>
        </Card>

        <Card className="border-gray-200 bg-gray-50/30">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Recordatorios sin respuesta</CardTitle>
            <Clock className="h-4 w-4 text-gray-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-gray-600">
              {Math.max(0, mensajesPagados - (stats?.totalConfirmed || 0) - (stats?.totalCancelled || 0))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Tasa sin respuesta: <span className="font-semibold text-gray-600">
                {mensajesPagados > 0
                  ? (((mensajesPagados - (stats?.totalConfirmed || 0) - (stats?.totalCancelled || 0)) / mensajesPagados) * 100).toFixed(1)
                  : 0}%
              </span>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Fila 2: Conversaciones Iniciadas por Pacientes */}
      <Card className="border-blue-300 bg-blue-50/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-blue-600" />
            Conversaciones Iniciadas por Pacientes
          </CardTitle>
          <CardDescription>
            Pacientes que escriben por su cuenta, sin un recordatorio previo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="text-center p-4 bg-white rounded-lg border border-blue-100">
              <MessageCircle className="h-6 w-6 text-blue-500 mx-auto mb-2" />
              <div className="text-3xl font-bold text-blue-600">{stats?.totalUserInitiated || 0}</div>
              <div className="text-sm text-muted-foreground mt-1">Conversaciones iniciadas</div>
              <div className="text-xs text-blue-600 mt-1">Por pacientes</div>
            </div>

            <div className="text-center p-4 bg-white rounded-lg border border-blue-100">
              <div className="text-3xl font-bold text-blue-600">{stats?.userInitiatedRate?.toFixed(1) || 0}%</div>
              <div className="text-sm text-muted-foreground mt-1">Tasa de conversaciones iniciadas por pacientes</div>
              <div className="text-xs text-blue-600 mt-1">Del total de conversaciones</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Fila 3: Turnos Reagendados y Nuevos Turnos */}
      <Card className="border-green-200 bg-green-50/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            Turnos Reagendados y Nuevos Turnos
          </CardTitle>
          <CardDescription>
            Resultado del proceso de reagendamiento y de las conversaciones iniciadas por pacientes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="text-center p-4 bg-white rounded-lg border border-green-100">
              <CalendarClock className="h-6 w-6 text-amber-500 mx-auto mb-2" />
              <div className="text-3xl font-bold text-green-600">{stats?.totalRescheduled || 0}</div>
              <div className="text-sm text-muted-foreground mt-1">Turnos reagendados</div>
              <div className="text-xs text-green-600 mt-1">
                De {stats?.totalRescheduleStarted || 0} procesos iniciados ({stats?.rescheduleConversionRate?.toFixed(1) || 0}%)
              </div>
            </div>

            <div className="text-center p-4 bg-white rounded-lg border border-green-100">
              <PlusCircle className="h-6 w-6 text-green-500 mx-auto mb-2" />
              <div className="text-3xl font-bold text-green-600">{stats?.totalNewAppointments || 0}</div>
              <div className="text-sm text-muted-foreground mt-1">Nuevos turnos agendados exitosamente</div>
              <div className="text-xs text-green-600 mt-1">
                De {stats?.totalUserInitiated || 0} conversaciones iniciadas ({newAppointmentConversionRate.toFixed(1)}%)
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Fila 4: Total de Interacciones */}
      <Card className="border-purple-200 bg-purple-50/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-purple-600" />
            Total de Interacciones
          </CardTitle>
          <CardDescription>
            Sumatoria de recordatorios enviados y conversaciones iniciadas por pacientes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-3">
            <div className="text-center p-4 bg-white rounded-lg border border-purple-100">
              <TrendingUp className="h-6 w-6 text-purple-500 mx-auto mb-2" />
              <div className="text-3xl font-bold text-purple-600">
                {mensajesPagados + (stats?.totalUserInitiated || 0)}
              </div>
              <div className="text-sm text-muted-foreground mt-1">Total de interacciones</div>
            </div>

            <div className="text-center p-4 bg-white rounded-lg border border-purple-100">
              <Send className="h-6 w-6 text-purple-400 mx-auto mb-2" />
              <div className="text-3xl font-bold text-purple-600">{mensajesPagados}</div>
              <div className="text-sm text-muted-foreground mt-1">Recordatorios enviados</div>
            </div>

            <div className="text-center p-4 bg-white rounded-lg border border-purple-100">
              <MessageCircle className="h-6 w-6 text-purple-400 mx-auto mb-2" />
              <div className="text-3xl font-bold text-purple-600">{stats?.totalUserInitiated || 0}</div>
              <div className="text-sm text-muted-foreground mt-1">Conversaciones iniciadas</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tiempos de respuesta */}
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

      {/* Tasa de Respuesta General */}
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

      {(!stats || (mensajesPagados === 0 && stats.totalConfirmed === 0 && stats.totalUserInitiated === 0)) && (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">Aún no hay datos de estadísticas para este cliente.</p>
            <p className="text-sm text-muted-foreground mt-2">
              Las estadísticas se actualizarán automáticamente cuando:
            </p>
            <ul className="text-sm text-muted-foreground mt-2 space-y-1">
              <li>- Se reciban recordatorios de turnos a través del proxylistener</li>
              <li>- Los pacientes confirmen sus turnos presionando el botón de confirmación</li>
              <li>- Los pacientes cancelen sus turnos presionando el botón de cancelación</li>
              <li>- Se reagenden turnos mediante la función de reserva (set_turno)</li>
              <li>- Los pacientes inicien conversaciones sin un recordatorio previo (user-initiated)</li>
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
