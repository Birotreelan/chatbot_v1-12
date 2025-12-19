"use client"

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ConsumptionSummaryCard } from "./consumption-summary-card"
import { ConversationCategoryBreakdown } from "./conversation-category-breakdown"
import { ConsumptionChart } from "./consumption-chart"
import { CountryBreakdown } from "./country-breakdown"
import type { WhatsAppConfig, ConsumptionSummary } from "@/lib/types"

export function ConsumptionDashboard() {
  const [configs, setConfigs] = useState<WhatsAppConfig[]>([])
  const [selectedConfigId, setSelectedConfigId] = useState<string>("")
  const [dateRange, setDateRange] = useState<"7d" | "30d" | "90d">("30d")
  const [loading, setLoading] = useState(false)
  const [consumptionData, setConsumptionData] = useState<ConsumptionSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Cargar configuraciones disponibles
  useEffect(() => {
    async function loadConfigs() {
      try {
        const response = await fetch("/api/dashboard/configs")
        if (response.ok) {
          const data = await response.json()
          setConfigs(data)
          // Seleccionar la primera configuración por defecto
          if (data.length > 0) {
            setSelectedConfigId(data[0].id)
          }
        }
      } catch (error) {
        console.error("[Consumos] Error al cargar configuraciones:", error)
      }
    }
    loadConfigs()
  }, [])

  // Cargar datos de consumo cuando cambia la configuración o el rango de fechas
  useEffect(() => {
    if (!selectedConfigId) return

    async function loadConsumptionData() {
      setLoading(true)
      setError(null)

      try {
        // Calcular fechas según el rango seleccionado
        const endDate = new Date()
        const startDate = new Date()

        switch (dateRange) {
          case "7d":
            startDate.setDate(endDate.getDate() - 7)
            break
          case "30d":
            startDate.setDate(endDate.getDate() - 30)
            break
          case "90d":
            startDate.setDate(endDate.getDate() - 90)
            break
        }

        const startDateStr = startDate.toISOString().split("T")[0]
        const endDateStr = endDate.toISOString().split("T")[0]

        const url = `/api/analytics/consumption?configId=${selectedConfigId}&startDate=${startDateStr}&endDate=${endDateStr}&granularity=DAILY`

        console.log("[v0] Fetching consumption data from:", url)

        const response = await fetch(url)

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || "Error al cargar datos")
        }

        const data = await response.json()
        console.log("[v0] Consumption data received:", data)
        setConsumptionData(data)
      } catch (error) {
        console.error("[v0] Error loading consumption data:", error)
        setError(error instanceof Error ? error.message : "Error desconocido")
      } finally {
        setLoading(false)
      }
    }

    loadConsumptionData()
  }, [selectedConfigId, dateRange])

  const selectedConfig = configs.find((c) => c.id === selectedConfigId)

  return (
    <div className="space-y-6">
      {/* Controles de filtrado */}
      <Card className="p-6">
        <div className="flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1">
            <label className="text-sm font-medium mb-2 block">Cuenta de WhatsApp</label>
            <Select value={selectedConfigId} onValueChange={setSelectedConfigId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona una cuenta" />
              </SelectTrigger>
              <SelectContent>
                {configs.map((config) => (
                  <SelectItem key={config.id} value={config.id}>
                    {config.displayName} - {config.phoneNumberId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1">
            <label className="text-sm font-medium mb-2 block">Período</label>
            <Select value={dateRange} onValueChange={(value: "7d" | "30d" | "90d") => setDateRange(value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Últimos 7 días</SelectItem>
                <SelectItem value="30d">Últimos 30 días</SelectItem>
                <SelectItem value="90d">Últimos 90 días</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button onClick={() => setDateRange(dateRange)} disabled={loading}>
            {loading ? "Cargando..." : "Actualizar"}
          </Button>
        </div>
      </Card>

      {/* Mensaje de error */}
      {error && (
        <Card className="p-6 border-destructive">
          <div className="text-destructive">
            <h3 className="font-semibold mb-2">Error al cargar datos</h3>
            <p className="text-sm">{error}</p>
            <p className="text-sm mt-2 text-muted-foreground">
              Esto puede ocurrir si el token de acceso no tiene los permisos necesarios o si la cuenta no tiene
              habilitadas las analíticas.
            </p>
          </div>
        </Card>
      )}

      {/* Contenido principal */}
      {loading && (
        <Card className="p-12 text-center">
          <div className="flex items-center justify-center gap-3">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            <span className="text-muted-foreground">Cargando datos de consumo...</span>
          </div>
        </Card>
      )}

      {!loading && consumptionData && (
        <>
          {/* Resumen general */}
          <ConsumptionSummaryCard data={consumptionData} />

          {/* Desglose por categoría */}
          <ConversationCategoryBreakdown data={consumptionData} />

          {/* Gráfico de tendencias */}
          <ConsumptionChart data={consumptionData} />

          {/* Desglose por país */}
          <CountryBreakdown data={consumptionData} />
        </>
      )}

      {!loading && !consumptionData && !error && (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground">Selecciona una cuenta para ver los datos de consumo</p>
        </Card>
      )}
    </div>
  )
}
