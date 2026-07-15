"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { monthValueToRange } from "./month-selector"

interface FacturacionCliente {
  clienteId: string
  clienteIdBase: string
  nombreCliente: string
  totalInteracciones: number
}

const formatoUSDMoney = new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", maximumFractionDigits: 2 })
const formatoARS = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 })

interface FacturacionTableProps {
  title?: string
  apiPath?: string
  cantidadLabel?: string
  month: string // formato "YYYY-MM", controlado por el contenedor padre
  dolarVenta: number | null // cotización compartida, controlada por el contenedor padre
}

export function FacturacionTable({
  title = "Facturación de clientes Wpp con IA",
  apiPath = "/api/facturacion/interacciones",
  cantidadLabel = "Total de Interacciones",
  month,
  dolarVenta,
}: FacturacionTableProps) {
  const [clientes, setClientes] = useState<FacturacionCliente[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [precios, setPrecios] = useState<Record<string, number>>({})
  const [guardando, setGuardando] = useState<Record<string, boolean>>({})

  const loadData = useCallback(async () => {
    try {
      setError(null)
      const { fechaInicio, fechaFin } = monthValueToRange(month)
      const [interaccionesRes, preciosRes] = await Promise.all([
        fetch(`${apiPath}?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}`),
        fetch("/api/facturacion/precios"),
      ])

      if (!interaccionesRes.ok) {
        const data = await interaccionesRes.json().catch(() => ({}))
        throw new Error(data.error || "Error al cargar datos de facturación")
      }
      const data = await interaccionesRes.json()
      setClientes(data.clientes || [])

      if (preciosRes.ok) {
        const preciosData = await preciosRes.json()
        setPrecios(preciosData.precios || {})
      }
    } catch (err) {
      console.error("Error cargando facturación:", err)
      setError(err instanceof Error ? err.message : "Error al cargar datos")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [month, apiPath])

  useEffect(() => {
    setLoading(true)
    loadData()
  }, [loadData])

  const handleRefresh = () => {
    setRefreshing(true)
    loadData()
  }

  const handlePrecioChange = (clienteIdBase: string, valor: string) => {
    const num = parseFloat(valor)
    setPrecios((prev) => ({ ...prev, [clienteIdBase]: Number.isFinite(num) ? num : 0 }))
  }

  const handlePrecioBlur = async (clienteIdBase: string) => {
    const valor = precios[clienteIdBase] ?? 0
    setGuardando((prev) => ({ ...prev, [clienteIdBase]: true }))
    try {
      await fetch("/api/facturacion/precios", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId: clienteIdBase, valor }),
      })
    } catch (err) {
      console.error("Error guardando precio:", err)
    } finally {
      setGuardando((prev) => ({ ...prev, [clienteIdBase]: false }))
    }
  }

  const totalGeneral = clientes.reduce((sum, c) => sum + c.totalInteracciones, 0)
  const totalGeneralValorUSD = clientes.reduce((sum, c) => {
    const precio = precios[c.clienteIdBase] ?? 0
    return sum + c.totalInteracciones * precio
  }, 0)
  const totalGeneralValorARS = dolarVenta ? totalGeneralValorUSD * dolarVenta : 0

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{cantidadLabel} por clínica en el período seleccionado</CardDescription>
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
                <TableHead className="text-right">{cantidadLabel}</TableHead>
                <TableHead className="text-right">Valor por unidad (USD)</TableHead>
                <TableHead className="text-right">Valor Total Dólares</TableHead>
                <TableHead className="text-right">Valor Total Pesos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clientes.map((cliente) => {
                const precio = precios[cliente.clienteIdBase] ?? 0
                const valorTotalUSD = cliente.totalInteracciones * precio
                const valorTotalARS = dolarVenta ? valorTotalUSD * dolarVenta : null
                return (
                  <TableRow key={cliente.clienteId}>
                    <TableCell className="font-medium">{cliente.nombreCliente}</TableCell>
                    <TableCell className="text-right">
                      {cliente.totalInteracciones.toLocaleString("es-AR")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="w-28 ml-auto text-right"
                        value={precios[cliente.clienteIdBase] ?? ""}
                        onChange={(e) => handlePrecioChange(cliente.clienteIdBase, e.target.value)}
                        onBlur={() => handlePrecioBlur(cliente.clienteIdBase)}
                        disabled={guardando[cliente.clienteIdBase]}
                      />
                    </TableCell>
                    <TableCell className="text-right">{formatoUSDMoney.format(valorTotalUSD)}</TableCell>
                    <TableCell className="text-right">
                      {valorTotalARS !== null ? formatoARS.format(valorTotalARS) : "—"}
                    </TableCell>
                  </TableRow>
                )
              })}
              <TableRow className="font-semibold bg-muted/50">
                <TableCell>Total general</TableCell>
                <TableCell className="text-right">{totalGeneral.toLocaleString("es-AR")}</TableCell>
                <TableCell />
                <TableCell className="text-right">{formatoUSDMoney.format(totalGeneralValorUSD)}</TableCell>
                <TableCell className="text-right">{formatoARS.format(totalGeneralValorARS)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
