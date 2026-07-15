"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { MonthSelector, getCurrentMonthValue, monthValueToRange } from "./month-selector"

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

  const [month, setMonth] = useState<string>(getCurrentMonthValue())

  const loadData = useCallback(async () => {
    try {
      setError(null)
      const { fechaInicio, fechaFin } = monthValueToRange(month)
      const response = await fetch(
        `/api/facturacion/interacciones?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}`,
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
  }, [month])

  useEffect(() => {
    setLoading(true)
    loadData()
  }, [loadData])

  const handleRefresh = () => {
    setRefreshing(true)
    loadData()
  }

  const totalGeneral = clientes.reduce((sum, c) => sum + c.totalInteracciones, 0)
  const esMesEnCurso = month === getCurrentMonthValue()

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <MonthSelector value={month} onChange={setMonth} />
        {esMesEnCurso && (
          <span className="text-sm font-semibold text-red-600">Consumo en curso</span>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Facturación de clientes Wpp con IA</CardTitle>
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
