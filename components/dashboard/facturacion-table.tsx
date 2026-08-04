"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2, RefreshCw, Plus, X } from "lucide-react"
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

  const [alias, setAlias] = useState<Record<string, string>>({})
  const [guardandoAlias, setGuardandoAlias] = useState<Record<string, boolean>>({})

  const [cuit, setCuit] = useState<Record<string, string[]>>({})
  const [guardandoCuit, setGuardandoCuit] = useState<Record<string, boolean>>({})

  const loadData = useCallback(async () => {
    try {
      setError(null)
      const { fechaInicio, fechaFin } = monthValueToRange(month)
      const [interaccionesRes, preciosRes, aliasRes, cuitRes] = await Promise.all([
        fetch(`${apiPath}?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}`),
        fetch("/api/facturacion/precios"),
        fetch("/api/facturacion/alias"),
        fetch("/api/facturacion/cuit"),
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

      if (aliasRes.ok) {
        const aliasData = await aliasRes.json()
        setAlias(aliasData.alias || {})
      }

      if (cuitRes.ok) {
        const cuitData = await cuitRes.json()
        setCuit(cuitData.cuit || {})
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

  // Alias y CUIT se guardan por clienteId (clave de la FILA, no del cliente
  // real): un cliente multi-sede tiene un clienteIdBase compartido pero un
  // clienteId distinto por sede (sufijo "::0", "::1", ...). Si se usara
  // clienteIdBase acá, todas las sedes de un mismo cliente compartirían el
  // mismo alias/CUIT (bug reportado: campos "encadenados" entre sedes). El
  // precio por unidad SÍ sigue usando clienteIdBase a propósito, porque es un
  // único valor por cliente real, no por sede.
  const handleAliasChange = (clienteId: string, valor: string) => {
    setAlias((prev) => ({ ...prev, [clienteId]: valor }))
  }

  const handleAliasBlur = async (clienteId: string) => {
    const valor = alias[clienteId] ?? ""
    setGuardandoAlias((prev) => ({ ...prev, [clienteId]: true }))
    try {
      await fetch("/api/facturacion/alias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId, alias: valor }),
      })
    } catch (err) {
      console.error("Error guardando alias:", err)
    } finally {
      setGuardandoAlias((prev) => ({ ...prev, [clienteId]: false }))
    }
  }

  // El CUIT es una lista (un cliente puede tener más de un CUIT). Si todavía
  // no hay nada cargado para esa fila, se muestra un único input vacío para
  // poder empezar a escribir.
  const getCuitList = (clienteId: string): string[] => {
    const lista = cuit[clienteId]
    return lista && lista.length > 0 ? lista : [""]
  }

  const handleCuitChange = (clienteId: string, index: number, valor: string) => {
    setCuit((prev) => {
      const lista = [...(prev[clienteId] ?? [""])]
      lista[index] = valor
      return { ...prev, [clienteId]: lista }
    })
  }

  const saveCuitList = async (clienteId: string, lista: string[]) => {
    setGuardandoCuit((prev) => ({ ...prev, [clienteId]: true }))
    try {
      await fetch("/api/facturacion/cuit", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId, cuit: lista }),
      })
    } catch (err) {
      console.error("Error guardando CUIT:", err)
    } finally {
      setGuardandoCuit((prev) => ({ ...prev, [clienteId]: false }))
    }
  }

  const handleCuitBlur = (clienteId: string) => {
    saveCuitList(clienteId, getCuitList(clienteId))
  }

  const handleAddCuit = (clienteId: string) => {
    setCuit((prev) => ({ ...prev, [clienteId]: [...(prev[clienteId] ?? [""]), ""] }))
  }

  const handleRemoveCuit = (clienteId: string, index: number) => {
    const listaActual = getCuitList(clienteId)
    const nuevaLista = listaActual.filter((_, i) => i !== index)
    setCuit((prev) => ({ ...prev, [clienteId]: nuevaLista }))
    saveCuitList(clienteId, nuevaLista)
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
                <TableHead>Alias</TableHead>
                <TableHead>CUIT</TableHead>
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
                    <TableCell>
                      <Input
                        type="text"
                        placeholder="—"
                        className="w-36"
                        value={alias[cliente.clienteId] ?? ""}
                        onChange={(e) => handleAliasChange(cliente.clienteId, e.target.value)}
                        onBlur={() => handleAliasBlur(cliente.clienteId)}
                        disabled={guardandoAlias[cliente.clienteId]}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {getCuitList(cliente.clienteId).map((valor, idx) => {
                          const lista = getCuitList(cliente.clienteId)
                          const esUltimo = idx === lista.length - 1
                          return (
                            <div key={idx} className="flex items-center gap-1">
                              <Input
                                type="text"
                                placeholder="—"
                                className="w-32"
                                value={valor}
                                onChange={(e) => handleCuitChange(cliente.clienteId, idx, e.target.value)}
                                onBlur={() => handleCuitBlur(cliente.clienteId)}
                                disabled={guardandoCuit[cliente.clienteId]}
                              />
                              {esUltimo ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 shrink-0"
                                  onClick={() => handleAddCuit(cliente.clienteId)}
                                  title="Agregar otro CUIT"
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </Button>
                              ) : (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 shrink-0"
                                  onClick={() => handleRemoveCuit(cliente.clienteId, idx)}
                                  title="Quitar este CUIT"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </TableCell>
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
                <TableCell />
                <TableCell />
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
