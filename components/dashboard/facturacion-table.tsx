"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2, RefreshCw, Plus, X } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { monthValueToRange } from "./month-selector"
import { OBSERVACION_MAX } from "@/lib/servicio-observacion-texto"
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
  /**
   * ── Lo que cambia entre Facturación y Servicio (16/10/2026) ──────────────
   *
   * Las dos pestañas usan esta misma tabla. Los defaults de abajo son
   * exactamente lo que hacía antes de que existiera Servicio, así que
   * Facturación no pasa ninguno de estos props y no cambia en nada.
   *
   * Se eligió parametrizar en vez de copiar la tabla: son 585 líneas, y acá
   * adentro está el cálculo de lo que se factura. Dos copias significaría
   * arreglar dos veces cada error de ese cálculo, y descubrir la segunda vez
   * tarde.
   */
  /** Alias y CUIT son de Facturación. Servicio no los muestra. */
  mostrarAliasYCuit?: boolean
  /**
   * La columna de costo (mensajes con cargo de Meta × costo por mensaje).
   *
   * Sólo Servicio, desde el 27/10/2026. Facturación la mostraba como "Costo
   * monotributo", pero es nuestro costo y no algo que se le facture al
   * cliente: el mismo argumento por el que el margen ya era sólo de Servicio.
   */
  mostrarCosto?: boolean
  /** Título de la columna de costo, si se muestra. */
  etiquetaCosto?: string
  /** Nota libre por cliente. Sólo Servicio. Ver lib/servicio-observaciones.ts. */
  mostrarObservacion?: boolean
  /** De dónde salen y a dónde se guardan los valores por unidad. */
  apiPathPrecios?: string
  /**
   * Si mirar un mes terminado lo CIERRA.
   *
   * Facturación sí: es quien factura. Servicio no — ver la nota larga en
   * app/api/facturacion/interacciones/route.ts.
   */
  cerrarMes?: boolean
  /**
   * Usar el precio y el dólar de ESTA pestaña aunque el mes esté cerrado.
   *
   * Las UNIDADES siguen saliendo del cierre igual: es lo que mantiene los
   * conteos idénticos entre las dos pestañas. Lo único que cambia es por
   * cuánto se multiplican.
   *
   * Lo decide el llamador según el período, no esta tabla: ver
   * lib/servicio-calculo.ts.
   */
  usarValoresPropios?: boolean
  /**
   * Las dos columnas de resultado: ingresos menos costo, en dólares y en pesos.
   *
   * Sólo Servicio. En Facturación no corresponde: esa pestaña muestra lo que se
   * le factura al cliente, y el costo de Meta es nuestro — restarlo ahí
   * mezclaría dos cosas que se miran por separado.
   */
  mostrarMargen?: boolean
}

export function FacturacionTable({
  title = "Facturación de clientes Wpp con IA",
  apiPath = "/api/facturacion/interacciones",
  cantidadLabel = "Total de Interacciones",
  month,
  dolarVenta,
  mostrarAliasYCuit = true,
  mostrarCosto = false,
  etiquetaCosto = "Costo",
  mostrarObservacion = false,
  apiPathPrecios = "/api/facturacion/precios",
  cerrarMes = true,
  usarValoresPropios = false,
  mostrarMargen = false,
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

  const [observacion, setObservacion] = useState<Record<string, string>>({})
  const [guardandoObservacion, setGuardandoObservacion] = useState<Record<string, boolean>>({})

  const loadData = useCallback(async () => {
    try {
      setError(null)
      const { fechaInicio, fechaFin } = monthValueToRange(month)
      // Alias, CUIT y observaciones sólo se piden si la pestaña los muestra:
      // son endpoints distintos con guardas distintas, y pedir el de
      // observaciones desde Facturación daría un 403 en la consola cada vez.
      const [interaccionesRes, preciosRes, aliasRes, cuitRes, observacionRes] = await Promise.all([
        fetch(`${apiPath}?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}${cerrarMes ? "" : "&cerrar=0"}`),
        fetch(apiPathPrecios),
        mostrarAliasYCuit ? fetch("/api/facturacion/alias") : null,
        mostrarAliasYCuit ? fetch("/api/facturacion/cuit") : null,
        mostrarObservacion ? fetch("/api/servicio/observaciones") : null,
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

      if (aliasRes?.ok) {
        const aliasData = await aliasRes.json()
        setAlias(aliasData.alias || {})
      }

      if (cuitRes?.ok) {
        const cuitData = await cuitRes.json()
        setCuit(cuitData.cuit || {})
      }

      if (observacionRes?.ok) {
        const observacionData = await observacionRes.json()
        setObservacion(observacionData.observaciones || {})
      }
    } catch (err) {
      console.error("Error cargando facturación:", err)
      setError(err instanceof Error ? err.message : "Error al cargar datos")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [month, apiPath, apiPathPrecios, cerrarMes, mostrarAliasYCuit, mostrarObservacion])

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
      await fetch(apiPathPrecios, {
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

  /**
   * La observación de Servicio. Mismo patrón que el alias: se escribe libre y
   * se guarda al salir del campo.
   *
   * Se guarda lo que DEVUELVE el servidor, no lo tipeado: el endpoint recorta a
   * OBSERVACION_MAX y hace trim, y si la tabla se quedara con el texto original
   * mostraría algo distinto de lo que está en Redis hasta recargar.
   */
  const handleObservacionChange = (clienteId: string, valor: string) => {
    setObservacion((prev) => ({ ...prev, [clienteId]: valor }))
  }

  const handleObservacionBlur = async (clienteId: string) => {
    const valor = observacion[clienteId] ?? ""
    setGuardandoObservacion((prev) => ({ ...prev, [clienteId]: true }))
    try {
      const r = await fetch("/api/servicio/observaciones", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId, observacion: valor }),
      })
      if (r.ok) {
        const data = await r.json()
        setObservacion((prev) => ({ ...prev, [clienteId]: data.observacion ?? "" }))
      }
    } catch (err) {
      console.error("Error guardando observación:", err)
    } finally {
      setGuardandoObservacion((prev) => ({ ...prev, [clienteId]: false }))
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
  /**
   * El precio y el dólar con los que se calcula una fila.
   *
   * Estaba resuelto a mano en cuatro lugares —los dos totales, la fila y la
   * celda del precio— con la misma expresión copiada. Al sumar Servicio, que
   * usa sus propios valores aunque el mes esté cerrado, cuatro copias eran
   * cuatro oportunidades de que un total dijera una cosa y su fila otra.
   *
   * `congelado` es lo que decide todo: un mes cerrado mirado desde Facturación
   * usa lo que quedó guardado y no se edita. Desde Servicio, con
   * `usarValoresPropios`, se ignora ese precio —no las unidades— y se usa el
   * de esta pestaña.
   */
  const valoresDeLaFila = (c: FacturacionCliente) => {
    const congelado = Boolean(c.cierre) && !usarValoresPropios
    const precio = congelado ? (c.cierre!.precioUnitarioUsd ?? 0) : (precios[c.clienteIdBase] ?? 0)
    const cotizacion = congelado ? c.cierre!.dolarVenta : dolarVenta

    const ingresoUSD = (c.totalInteracciones || 0) * precio

    // `null` y no 0 cuando la fila no trae `mensajesConCargoDeMeta`: con 0 el
    // margen diría "ingresos enteros, costo cero", que es una afirmación. Lo
    // que pasa es que no sabemos cuánto costó — el mismo criterio que la
    // columna de costo, que ahí muestra un guión.
    const costoUSD =
      c.mensajesConCargoDeMeta !== undefined
        ? c.mensajesConCargoDeMeta * COSTO_POR_MENSAJE_CON_CARGO_USD
        : null
    const margenUSD = costoUSD === null ? null : ingresoUSD - costoUSD

    return {
      congelado,
      precio,
      cotizacion,
      ingresoUSD,
      ingresoARS: cotizacion ? ingresoUSD * cotizacion : null,
      costoUSD,
      margenUSD,
      margenARS: margenUSD !== null && cotizacion ? margenUSD * cotizacion : null,
    }
  }

  // El mes está cerrado si CUALQUIER fila trae cierre: se cierran todas juntas
  // la primera vez que alguien lo abre, así que es la misma condición.
  //
  // ── Sólo lo administra la pestaña que cierra (16/10/2026) ────────────────
  //
  // Esto gobierna el cartel "Cerrado" y el botón "Reabrir mes", y ese botón
  // BORRA el cierre guardado. Servicio lee los cierres de Facturación para que
  // sus conteos coincidan, pero no los administra: sin este `cerrarMes`, desde
  // la pestaña Servicio se podía borrar el cierre contable de un mes ya
  // facturado, y el cartel "Cerrado" además contradecía el precio editable que
  // esa misma pestaña muestra al lado.
  const cierre = cerrarMes ? clientes.find((c) => c.cierre)?.cierre : undefined
  const totalGeneral = clientes.reduce((sum, c) => sum + (c.totalInteracciones || 0), 0)

  // ── Las dos columnas del desglose ─────────────────────────────────────────
  //
  // Se muestran si las filas traen el desglose, y no comparando el mes contra
  // una fecha escrita acá. La diferencia importa: el que decide si el desglose
  // existe es la regla del período, que vive en facturacion-reglas.ts, y un
  // `month >= "2026-10"` suelto en este archivo sería una segunda copia de esa
  // decisión que el día del próximo cambio nadie va a recordar actualizar.
  const hayDesglose = clientes.some((c) => c.recordatorios !== undefined)

  // ── La etiqueta de la columna sigue a la fórmula ───────────────────────────
  //
  // La tabla de clientes sin IA llama a su columna "Mensajes pagados" porque
  // eso era exactamente lo que se les facturaba. Desde octubre 2026 facturan
  // igual que los de IA —mensajes de servicio gratuitos incluidos—, así que ese
  // nombre dejó de describir la columna: diría "pagados" sobre un número que
  // incluye los que no se pagan.
  //
  // Se decide con `hayDesglose`, que es la misma condición que determina si la
  // fórmula nueva se aplicó. Un mes viejo sigue mostrando la etiqueta vieja,
  // que para ese mes es la correcta.
  const etiquetaCantidad = hayDesglose ? "Total de Interacciones" : cantidadLabel
  const totalRecordatorios = clientes.reduce((sum, c) => sum + (c.recordatorios || 0), 0)
  const totalServicios = clientes.reduce((sum, c) => sum + (c.serviciosFacturados || 0), 0)

  // ── El costo ──────────────────────────────────────────────────────────────
  //
  // Corre sólo sobre los mensajes que Meta nos cobra, así que su base NO es el
  // total de la fila: los mensajes de servicio gratuitos se le facturan al
  // cliente y a nosotros no nos cuestan. Por eso esta columna no cierra con las
  // otras tres, y el encabezado lo aclara.
  //
  // Sólo en las pestañas que lo piden (`mostrarCosto`): Servicio sí,
  // Facturación no. El margen de Servicio no depende de esto — lo calcula
  // valoresDeLaFila por su cuenta.
  const hayCosto = mostrarCosto && clientes.some((c) => c.mensajesConCargoDeMeta !== undefined)
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
    const { precio } = valoresDeLaFila(c)
    return sum + (c.totalInteracciones || 0) * precio
  }, 0)

  // El total en pesos se suma fila por fila y no con una cotización única: en
  // un mes cerrado cada fila puede tener la suya, y multiplicar el total en
  // dólares por el dólar de hoy daría un número que no coincide con la suma de
  // lo que muestra cada renglón.
  const totalGeneralValorARS = clientes.reduce((sum, c) => {
    const { ingresoARS } = valoresDeLaFila(c)
    return sum + (ingresoARS || 0)
  }, 0)

  /**
   * El resultado del total: la SUMA de los resultados de cada fila, no
   * "ingreso total menos costo total".
   *
   * Dan distinto cuando alguna fila no trae costo: aquella fórmula le restaría
   * el costo de las demás a una fila cuyo costo no conocemos, y el total no
   * coincidiría con la columna. Las filas sin costo quedan afuera, y se dice
   * cuántas son — un total que calla lo que dejó afuera es peor que uno que lo
   * aclara.
   */
  const filasSinCosto = clientes.filter((c) => c.mensajesConCargoDeMeta === undefined).length
  const totalMargenUSD = clientes.reduce((sum, c) => sum + (valoresDeLaFila(c).margenUSD || 0), 0)
  const totalMargenARS = clientes.reduce((sum, c) => sum + (valoresDeLaFila(c).margenARS || 0), 0)

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
              <>{etiquetaCantidad} por clínica en el período seleccionado</>
            )}
            {/* La relación entre las columnas, escrita. Si no se dice, dos
                columnas nuevas al lado del total se leen como tres cosas
                distintas y nadie sabe cuál se factura. */}
            {hayDesglose && (
              <span className="mt-1 block text-xs">
                Recordatorios enviados + mensajes de servicio = {etiquetaCantidad.toLowerCase()}.
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
                {mostrarAliasYCuit && (
                  <>
                    <TableHead>Alias</TableHead>
                    <TableHead>CUIT</TableHead>
                  </>
                )}
                {mostrarObservacion && <TableHead>Observación</TableHead>}
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
                <TableHead className="text-right">{etiquetaCantidad}</TableHead>
                {hayCosto && (
                  <TableHead className="text-right font-normal text-muted-foreground">
                    {etiquetaCosto}
                    {/* Se dice sobre qué corre. Al lado de tres columnas que
                        suman entre sí, una cuarta con otra base se lee como un
                        error de la tabla si no está explicado. */}
                    <span className="block text-[10px] font-normal">
                      US$ {COSTO_POR_MENSAJE_CON_CARGO_USD} ×{" "}
                      {totalConCargo === totalGeneral
                        ? etiquetaCantidad.toLowerCase()
                        : "mensajes con cargo de Meta"}
                    </span>
                  </TableHead>
                )}
                <TableHead className="text-right">Valor por unidad (USD)</TableHead>
                <TableHead className="text-right">Valor Total Dólares</TableHead>
                <TableHead className="text-right">Valor Total Pesos</TableHead>
                {mostrarMargen && (
                  <>
                    <TableHead className="text-right">Ingresos − costos Dólares</TableHead>
                    <TableHead className="text-right">Ingresos − costos Pesos</TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {clientes.map((cliente) => {
                // ── Un mes cerrado usa SUS valores, no los de hoy ───────
                //
                // Es el punto del congelado: si acá se aplicara el precio
                // actual o el dólar del día, el total de un mes ya facturado
                // volvería a moverse y el cierre no serviría de nada.
                const { precio, cotizacion, congelado, margenUSD, margenARS } =
                  valoresDeLaFila(cliente)
                const totalInteracciones = cliente.totalInteracciones || 0
                const valorTotalUSD = totalInteracciones * precio
                const valorTotalARS = cotizacion ? valorTotalUSD * cotizacion : null
                return (
                  <TableRow key={cliente.clienteId}>
                    <TableCell className="font-medium">{cliente.nombreCliente}</TableCell>
                    {mostrarAliasYCuit && (
                      <>
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
                      </>
                    )}
                    {mostrarObservacion && (
                      <TableCell>
                        <Input
                          type="text"
                          placeholder="—"
                          className="w-56"
                          maxLength={OBSERVACION_MAX}
                          value={observacion[cliente.clienteId] ?? ""}
                          onChange={(e) => handleObservacionChange(cliente.clienteId, e.target.value)}
                          onBlur={() => handleObservacionBlur(cliente.clienteId)}
                          disabled={guardandoObservacion[cliente.clienteId]}
                        />
                      </TableCell>
                    )}
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
                      {congelado && cliente.cierre ? (
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
                    {mostrarMargen && (
                      <>
                        {/* En rojo si da negativo: un resultado bajo cero se
                            tiene que ver de un vistazo, no leyendo el signo
                            menos en una tabla de veinte filas. */}
                        <TableCell
                          className={`text-right font-medium ${
                            margenUSD !== null && margenUSD < 0 ? "text-destructive" : ""
                          }`}
                        >
                          {margenUSD !== null ? formatoUSDMoney.format(margenUSD) : "—"}
                        </TableCell>
                        <TableCell
                          className={`text-right ${
                            margenARS !== null && margenARS < 0 ? "text-destructive" : ""
                          }`}
                        >
                          {margenARS !== null ? formatoARS.format(margenARS) : "—"}
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                )
              })}
              <TableRow className="font-semibold bg-muted/50">
                <TableCell>Total general</TableCell>
                {/* Las celdas vacías tienen que seguir a las columnas, o la
                    fila de totales se corre y cada número cae bajo el título
                    equivocado. */}
                {mostrarAliasYCuit && (
                  <>
                    <TableCell />
                    <TableCell />
                  </>
                )}
                {mostrarObservacion && <TableCell />}
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
                {mostrarMargen && (
                  <>
                    <TableCell
                      className={`text-right ${totalMargenUSD < 0 ? "text-destructive" : ""}`}
                    >
                      {formatoUSDMoney.format(totalMargenUSD)}
                      {filasSinCosto > 0 && (
                        <span className="block text-[10px] font-normal text-muted-foreground">
                          sin {filasSinCosto} fila{filasSinCosto === 1 ? "" : "s"} sin costo
                        </span>
                      )}
                    </TableCell>
                    <TableCell
                      className={`text-right ${totalMargenARS < 0 ? "text-destructive" : ""}`}
                    >
                      {formatoARS.format(totalMargenARS)}
                    </TableCell>
                  </>
                )}
              </TableRow>
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
