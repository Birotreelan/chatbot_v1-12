"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2, RefreshCw, Plus, X } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { monthValueToRange } from "./month-selector"
import { COSTO_POR_MENSAJE_CON_CARGO_USD, reglaPorId } from "@/lib/facturacion-reglas"

interface FacturacionCliente {
  clienteId: string
  clienteIdBase: string
  nombreCliente: string
  totalInteracciones: number
  /**
   * Las dos partes del total, desde octubre 2026. Ausentes en los meses con la
   * regla anterior, donde el total incluía las conversaciones iniciadas y el
   * desglose no habría cerrado.
   *
   * Que vengan del servidor y no se calculen acá es deliberado: son los mismos
   * números que se congelan en el cierre, así que un mes cerrado muestra el
   * desglose con el que se facturó y no uno reconstruido hoy.
   */
  recordatorios?: number
  /** TODOS los mensajes de servicio del período, con cargo o sin él. */
  serviciosFacturados?: number
  /**
   * Los mensajes que Meta sí cobra. Base del costo de monotributo: es nuestro
   * costo, no algo que se le facture al cliente.
   */
  mensajesConCargoDeMeta?: number
  /**
   * Presente cuando el mes está cerrado: trae el precio y el dólar con los que
   * se facturó. Ver lib/facturacion-cierre.ts.
   */
  cierre?: {
    periodo: string
    precioUnitarioUsd: number | null
    dolarVenta: number | null
    regla: "con_conversaciones" | "solo_enviados"
    cerradoEl: string
  }
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

  // Defensivo: totalInteracciones puede venir undefined/null si la fuente de
  // datos (servicio externo) no trae el campo para algún cliente puntual —
  // ver bug reportado 2026-08-13 (crasheaba toda la tabla con
  // "undefined is not an object (evaluating 'e.totalInteracciones.toLocaleString')").
  // El mes está cerrado si CUALQUIER fila trae cierre: se cierran todas juntas
  // la primera vez que alguien lo abre, así que es la misma condición.
  const cierre = clientes.find((c) => c.cierre)?.cierre
  const totalGeneral = clientes.reduce((sum, c) => sum + (c.totalInteracciones || 0), 0)

  // ── Las dos columnas del desglose ─────────────────────────────────────────
  //
  // Se muestran si las filas traen el desglose, y no comparando el mes contra
  // una fecha escrita acá. La diferencia importa: el que decide si el desglose
  // existe es la regla del período, que vive en facturacion-reglas.ts, y un
  // `month >= "2026-10"` suelto en este archivo sería una segunda copia de esa
  // decisión que el día del próximo cambio nadie va a recordar actualizar.
  const hayDesglose = clientes.some((c) => c.recordatorios !== undefined)
  const totalRecordatorios = clientes.reduce((sum, c) => sum + (c.recordatorios || 0), 0)
  const totalServicios = clientes.reduce((sum, c) => sum + (c.serviciosFacturados || 0), 0)

  // ── El costo de monotributo ───────────────────────────────────────────────
  //
  // Corre sólo sobre los mensajes que Meta nos cobra, así que su base NO es el
  // total de la fila: los mensajes de servicio gratuitos se le facturan al
  // cliente y a nosotros no nos cuestan. Por eso esta columna no cierra con las
  // otras tres, y el encabezado lo aclara.
  const hayCosto = clientes.some((c) => c.mensajesConCargoDeMeta !== undefined)
  const totalConCargo = clientes.reduce((sum, c) => sum + (c.mensajesConCargoDeMeta || 0), 0)
  const totalCostoUSD = totalConCargo * COSTO_POR_MENSAJE_CON_CARGO_USD

  async function reabrir() {
    if (
      !confirm(
        "Esto vuelve a calcular el mes con los datos y el dólar de HOY, y reemplaza el cierre guardado. " +
          "Usalo sólo si el cierre quedó mal. ¿Seguir?",
      )
    ) {
      return
    }
    await fetch(`/api/facturacion/cierre?mes=${encodeURIComponent(month)}`, { method: "DELETE" })
    setLoading(true)
    loadData()
  }

  const totalGeneralValorUSD = clientes.reduce((sum, c) => {
    const precio = c.cierre ? (c.cierre.precioUnitarioUsd ?? 0) : (precios[c.clienteIdBase] ?? 0)
    return sum + (c.totalInteracciones || 0) * precio
  }, 0)

  // El total en pesos se suma fila por fila y no con una cotización única: en
  // un mes cerrado cada fila puede tener la suya, y multiplicar el total en
  // dólares por el dólar de hoy daría un número que no coincide con la suma de
  // lo que muestra cada renglón.
  const totalGeneralValorARS = clientes.reduce((sum, c) => {
    const precio = c.cierre ? (c.cierre.precioUnitarioUsd ?? 0) : (precios[c.clienteIdBase] ?? 0)
    const cotizacion = c.cierre ? c.cierre.dolarVenta : dolarVenta
    return sum + (c.totalInteracciones || 0) * precio * (cotizacion || 0)
  }, 0)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            {title}
            {/* Que el mes esté cerrado tiene que verse: explica por qué el
                precio no se edita y por qué el total no cambia aunque se
                actualice. Sin el cartel, eso se lee como un error. */}
            {cierre && (
              <span className="rounded-md border border-primary/40 bg-primary/5 px-2 py-0.5 text-xs font-normal text-primary">
                Cerrado
              </span>
            )}
          </CardTitle>
          <CardDescription>
            {cierre ? (
              <>
                Mes cerrado el {new Date(cierre.cerradoEl).toLocaleDateString("es-AR")} con el dólar
                a ${cierre.dolarVenta?.toLocaleString("es-AR") ?? "—"}
                {/* La descripción sale del registro de reglas y no de un
                    ternario acá: con el próximo cambio, este archivo no se
                    toca. Ver lib/facturacion-reglas.ts. */}
                {reglaPorId(cierre.regla) ? ` · ${reglaPorId(cierre.regla)!.nombre}` : ""}
                . Estos valores ya no cambian.
              </>
            ) : (
              <>{cantidadLabel} por clínica en el período seleccionado</>
            )}
            {/* La relación entre las columnas, escrita. Si no se dice, dos
                columnas nuevas al lado del total se leen como tres cosas
                distintas y nadie sabe cuál se factura. */}
            {hayDesglose && (
              <span className="mt-1 block text-xs">
                Recordatorios enviados + mensajes de servicio = {cantidadLabel.toLowerCase()}.
                {" "}Los mensajes de servicio se cobran completos, con cargo de Meta o sin él.
              </span>
            )}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {cierre && (
            <Button variant="outline" size="sm" onClick={reabrir} disabled={loading || refreshing}>
              Reabrir mes
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading || refreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        </div>
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
                {hayDesglose && (
                  <>
                    <TableHead className="text-right font-normal text-muted-foreground">
                      Recordatorios enviados
                    </TableHead>
                    <TableHead className="text-right font-normal text-muted-foreground">
                      Mensajes de servicio
                    </TableHead>
                  </>
                )}
                <TableHead className="text-right">{cantidadLabel}</TableHead>
                {hayCosto && (
                  <TableHead className="text-right font-normal text-muted-foreground">
                    Costo monotributo
                    {/* Se dice sobre qué corre. Al lado de tres columnas que
                        suman entre sí, una cuarta con otra base se lee como un
                        error de la tabla si no está explicado. */}
                    <span className="block text-[10px] font-normal">
                      US$ {COSTO_POR_MENSAJE_CON_CARGO_USD} ×{" "}
                      {totalConCargo === totalGeneral
                        ? cantidadLabel.toLowerCase()
                        : "mensajes con cargo de Meta"}
                    </span>
                  </TableHead>
                )}
                <TableHead className="text-right">Valor por unidad (USD)</TableHead>
                <TableHead className="text-right">Valor Total Dólares</TableHead>
                <TableHead className="text-right">Valor Total Pesos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clientes.map((cliente) => {
                // ── Un mes cerrado usa SUS valores, no los de hoy ───────
                //
                // Es el punto del congelado: si acá se aplicara el precio
                // actual o el dólar del día, el total de un mes ya facturado
                // volvería a moverse y el cierre no serviría de nada.
                const precio = cliente.cierre
                  ? (cliente.cierre.precioUnitarioUsd ?? 0)
                  : (precios[cliente.clienteIdBase] ?? 0)
                const cotizacion = cliente.cierre ? cliente.cierre.dolarVenta : dolarVenta
                const totalInteracciones = cliente.totalInteracciones || 0
                const valorTotalUSD = totalInteracciones * precio
                const valorTotalARS = cotizacion ? valorTotalUSD * cotizacion : null
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
                    {hayDesglose && (
                      <>
                        {/* El guión, y no un 0, cuando esta fila no trae
                            desglose: un cero diría "este cliente no envió
                            recordatorios", que es un dato, y acá lo que pasa
                            es que no sabemos. */}
                        <TableCell className="text-right text-muted-foreground">
                          {cliente.recordatorios !== undefined
                            ? cliente.recordatorios.toLocaleString("es-AR")
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {cliente.serviciosFacturados !== undefined
                            ? cliente.serviciosFacturados.toLocaleString("es-AR")
                            : "—"}
                        </TableCell>
                      </>
                    )}
                    <TableCell className="text-right">
                      {totalInteracciones.toLocaleString("es-AR")}
                    </TableCell>
                    {hayCosto && (
                      <TableCell className="text-right text-muted-foreground">
                        {cliente.mensajesConCargoDeMeta !== undefined ? (
                          <>
                            {formatoUSDMoney.format(
                              cliente.mensajesConCargoDeMeta * COSTO_POR_MENSAJE_CON_CARGO_USD,
                            )}
                            {/* La cantidad va a la vista y no sólo el monto: sin
                                ella, el único modo de saber sobre cuántos
                                mensajes se calculó es dividir a mano.

                                Pero sólo si difiere del total de la fila. En la
                                tabla de clientes sin IA coinciden —lo que se
                                factura ES lo que Meta cobra—, y repetir el
                                mismo número al lado manda a buscar una
                                diferencia que no existe. */}
                            {cliente.mensajesConCargoDeMeta !== totalInteracciones && (
                              <span className="block text-[10px]">
                                {cliente.mensajesConCargoDeMeta.toLocaleString("es-AR")} con cargo
                              </span>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      {/* En un mes cerrado el precio no se edita: el total ya
                          no depende de él. Un campo editable que no cambia
                          nada es peor que uno bloqueado —se toca, no pasa
                          nada, y uno cree que el sistema falla—. */}
                      {cliente.cierre ? (
                        <span
                          className="block text-right text-muted-foreground"
                          title={`Precio con el que se facturó ${cliente.cierre.periodo}`}
                        >
                          {cliente.cierre.precioUnitarioUsd !== null
                            ? formatoUSDMoney.format(cliente.cierre.precioUnitarioUsd)
                            : "—"}
                        </span>
                      ) : (
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
                      )}
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
                {hayDesglose && (
                  <>
                    <TableCell className="text-right">
                      {totalRecordatorios.toLocaleString("es-AR")}
                    </TableCell>
                    <TableCell className="text-right">
                      {totalServicios.toLocaleString("es-AR")}
                    </TableCell>
                  </>
                )}
                <TableCell className="text-right">{totalGeneral.toLocaleString("es-AR")}</TableCell>
                {hayCosto && (
                  <TableCell className="text-right">
                    {formatoUSDMoney.format(totalCostoUSD)}
                    {totalConCargo !== totalGeneral && (
                      <span className="block text-[10px] font-normal text-muted-foreground">
                        {totalConCargo.toLocaleString("es-AR")} con cargo
                      </span>
                    )}
                  </TableCell>
                )}
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
