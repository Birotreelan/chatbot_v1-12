"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { DateRangeFilter } from "./date-range-filter"

interface FacturacionCliente {
  clienteId: string
  nombreCliente: string
  totalInteracciones: number
}

export function FacturacionTable() {
  const [clientes, setClientes] = useState<FacturacionCliente[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const today = new Date().toISOString().split("T")[0]
  const [startDate, setStartDate] = useState<string | null>(today)
  const [endDate, setEndDate] = useState<string | null>(today)

  const loadData = useCallback(async () => {
    if (!startDate || !endDate) return
    try {
      setError(null)
      const response = await fetch(
        `/api/facturacion/interacciones?fechaInicio=${startDate}&fechaFin=${endDate}`,
      )
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Error al cargar datos de facturación")
      }
      const data = await response.json()
      setClientes(data.clientes || [])
    } catch (err) {
      console.error("Error cargando facturación:", err)
      setError(err instanceof Error ? err.message : "Error al cargar datos")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [startDate, endDate])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleFilterChange = (newStartDate: string | null, newEndDate: string | null) => {
    setLoading(true)
    setStartDate(newStartDate)
    setEndDate(newEndDate)
  }

  const handleRefresh = () => {
    setRefreshing(true)
    loadData()
  }

  const totalGeneral = clientes.reduce((sum, c) => sum + c.totalInteracciones, 0)

  return (
    <div className="space-y-4">
      <DateRangeFilter onFilterChange={handleFilterChange} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Facturación por cliente</CardTitle>
            <CardDescription>Total de interacciones por clínica en el período seleccionado</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading || refreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center items-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-8 text-destructive text-sm">{error}</div>
          ) : clientes.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No hay clientes con datos en este período.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Total de Interacciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clientes.map((cliente) => (
                  <TableRow key={cliente.clienteId}>
                    <TableCell className="font-medium">{cliente.nombreCliente}</TableCell>
                    <TableCell className="text-right">{cliente.totalInteracciones.toLocaleString("es-AR")}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold bg-muted/50">
                  <TableCell>Total general</TableCell>
                  <TableCell className="text-right">{totalGeneral.toLocaleString("es-AR")}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
