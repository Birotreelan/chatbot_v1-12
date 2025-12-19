"use client"

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertCircle, Info } from "lucide-react"
import { ConsumptionSummaryCard } from "./consumption-summary-card"
import { ConversationCategoryBreakdown } from "./conversation-category-breakdown"
import { ConsumptionChart } from "./consumption-chart"
import { CountryBreakdown } from "./country-breakdown"
import type { WhatsAppConfig, ConsumptionSummary } from "@/lib/types"

export function ConsumptionDashboard() {
  const [configs, setConfigs] = useState<WhatsAppConfig[]>([])
  const [selectedConfigId, setSelectedConfigId] = useState<string>("")
  const [dateRange, setDateRange] = useState<"7d" | "30d" | "90d">("7d")
  const [loading, setLoading] = useState(false)
  const [consumptionData, setConsumptionData] = useState<ConsumptionSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorDetails, setErrorDetails] = useState<any>(null)

  // Cargar configuraciones disponibles
  useEffect(() => {
    async function loadConfigs() {
      try {
        console.log("[v0] Cargando configuraciones de WhatsApp...")
        const response = await fetch("/api/dashboard/configs")
        if (response.ok) {
          const data = await response.json()
          console.log("[v0] Configuraciones cargadas:", data.length)
          setConfigs(data)
          // Seleccionar la primera configuración por defecto
          if (data.length > 0) {
            setSelectedConfigId(data[0].id)
            console.log("[v0] Configuración seleccionada por defecto:", data[0].displayName)
          }
        } else {
          console.error("[v0] Error al cargar configuraciones:", response.status)
        }
      } catch (error) {
        console.error("[v0] Error al cargar configuraciones:", error)
      }
    }
    loadConfigs()
  }, [])

  // Cargar datos de consumo cuando cambia la configuración o el rango de fechas
  useEffect(() => {
    if (!selectedConfigId) {
      console.log("[v0] No hay configuración seleccionada, esperando...")
      return
    }

    async function loadConsumptionData() {
      setLoading(true)
      setError(null)
      setErrorDetails(null)

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

        // Formatear fechas manualmente para evitar problemas de timezone
        const formatDate = (date: Date) => {
          const year = date.getFullYear()
          const month = String(date.getMonth() + 1).padStart(2, "0")
          const day = String(date.getDate()).padStart(2, "0")
          return `${year}-${month}-${day}`
        }

        const startDateStr = formatDate(startDate)
        const endDateStr = formatDate(endDate)

        console.log("[v0] Fechas calculadas (cliente):", {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          startDateStr,
          endDateStr,
        })

        const url = `/api/analytics/consumption?configId=${selectedConfigId}&startDate=${startDateStr}&endDate=${endDateStr}&granularity=DAILY`

        console.log("[v0] Solicitando datos de consumo...")
        console.log("[v0] URL:", url)
        console.log("[v0] Rango de fechas:", { startDateStr, endDateStr })

        const response = await fetch(url)

        console.log("[v0] Respuesta recibida:", {
          status: response.status,
          ok: response.ok,
        })

        const data = await response.json()

        if (!response.ok) {
          console.error("[v0] Error en la respuesta:", data)
          setErrorDetails(data.details)
          throw new Error(data.error || "Error al cargar datos")
        }

        console.log("[v0] Datos de consumo recibidos:", data)
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

        {selectedConfig && (
          <div className="mt-4 p-3 bg-muted rounded-lg text-sm">
            <div className="font-medium mb-1">Configuración actual:</div>
            <div className="text-muted-foreground space-y-1">
              <div>Nombre: {selectedConfig.displayName}</div>
              <div>Phone ID: {selectedConfig.phoneNumberId}</div>
              <div>WABA ID: {selectedConfig.wabaId || "No configurado"}</div>
              <div>Token: {selectedConfig.accessToken ? "Configurado" : "No configurado"}</div>
            </div>
          </div>
        )}
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error al cargar datos</AlertTitle>
          <AlertDescription>
            <p className="mb-2">{error}</p>
            {errorDetails && (
              <details className="mt-2">
                <summary className="cursor-pointer font-medium">Ver detalles técnicos</summary>
                <pre className="mt-2 p-2 bg-black/20 rounded text-xs overflow-auto">
                  {JSON.stringify(errorDetails, null, 2)}
                </pre>
              </details>
            )}
            <p className="mt-3 text-xs">
              Posibles causas:
              <ul className="list-disc list-inside mt-1 space-y-1">
                <li>El access token no tiene permisos de analíticas</li>
                <li>El WABA ID no es correcto</li>
                <li>La cuenta factura a través de un BSP (no muestra costos)</li>
                <li>No hay datos para el período seleccionado</li>
              </ul>
            </p>
          </AlertDescription>
        </Alert>
      )}

      {!loading && consumptionData && consumptionData.totalConversations === 0 && consumptionData.messagesSent > 0 && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Datos de mensajería disponibles</AlertTitle>
          <AlertDescription>
            <p>
              Encontramos datos de mensajería para este período:{" "}
              <strong>{consumptionData.messagesSent.toLocaleString()} mensajes enviados</strong> y{" "}
              <strong>{consumptionData.messagesDelivered.toLocaleString()} entregados</strong>.
            </p>
            <p className="mt-2 text-xs">
              No hay datos de conversaciones disponibles. Esto puede significar:
              <ul className="list-disc list-inside mt-1 space-y-1">
                <li>Tu cuenta usa el modelo de facturación por mensajes (anterior a 2022)</li>
                <li>La cuenta factura a través de un BSP que no expone datos de conversaciones</li>
                <li>No hay suficiente actividad para generar analíticas de conversaciones</li>
              </ul>
            </p>
          </AlertDescription>
        </Alert>
      )}

      {!loading &&
        consumptionData &&
        consumptionData.totalConversations === 0 &&
        consumptionData.messagesSent === 0 && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Sin datos disponibles</AlertTitle>
            <AlertDescription>
              <p>No se encontraron datos para el período seleccionado.</p>
              <p className="mt-2 text-xs">
                Esto puede ser normal si:
                <ul className="list-disc list-inside mt-1 space-y-1">
                  <li>La cuenta no ha tenido actividad en este período</li>
                  <li>Es una cuenta nueva sin historial</li>
                  <li>El período seleccionado está fuera del rango de retención de datos (máx. 1 año)</li>
                </ul>
              </p>
            </AlertDescription>
          </Alert>
        )}

      {/* Contenido principal */}
      {loading && (
        <Card className="p-12 text-center">
          <div className="flex items-center justify-center gap-3">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            <span className="text-muted-foreground">Cargando datos de consumo...</span>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Consultando API de Meta WhatsApp Business</p>
        </Card>
      )}

      {!loading && consumptionData && (consumptionData.totalConversations > 0 || consumptionData.messagesSent > 0) && (
        <>
          {/* Resumen general */}
          <ConsumptionSummaryCard data={consumptionData} />

          {consumptionData.totalConversations > 0 && (
            <>
              {/* Desglose por categoría */}
              <ConversationCategoryBreakdown data={consumptionData} />

              {/* Gráfico de tendencias */}
              <ConsumptionChart data={consumptionData} />

              {/* Desglose por país */}
              <CountryBreakdown data={consumptionData} />
            </>
          )}
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
