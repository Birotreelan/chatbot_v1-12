"use client"

/**
 * Los resúmenes de la tarjeta y la conciliación con lo computado (30/10/2026).
 *
 * ── Qué pregunta contesta ──────────────────────────────────────────────────
 *
 * "¿Lo que el panel dice que gastamos en mensajes es lo que efectivamente nos
 * cobró la tarjeta?". Hasta ahora no había forma de saberlo: el panel cuenta
 * mensajes de un mes calendario y la tarjeta cierra en fechas móviles, así que
 * los dos números nunca coinciden y la diferencia no se podía explicar.
 *
 * ── Por qué muestra una cuenta corriente y no una comparación ──────────────
 *
 * Porque mes a mes NO tiene que cuadrar, y presentarlo como si tuviera que
 * cuadrar sería prometer algo imposible. Lo que cuadra es el acumulado: cada
 * mes suma lo computado, resta lo imputado, y el saldo se arrastra. El
 * razonamiento completo está en lib/servicio-conciliacion.ts.
 *
 * ── Analizar y guardar son dos botones ─────────────────────────────────────
 *
 * El primero no toca nada: muestra las líneas que entendió, los impuestos y las
 * verificaciones. Recién con eso a la vista se guarda. Un resumen cargado mal
 * desbalancea una cuenta que tiene que cerrar al centavo, y el error aparecería
 * meses después como un saldo raro que nadie puede rastrear.
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { Loader2, Trash2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { COSTO_DESGLOSADO_DESDE, impuestosDeUnCargoFijo } from "@/lib/servicio-costos"

const formatoUSD = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
})
const formatoARS = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2,
})

interface LineaDelResumen {
  fecha: string
  descripcion: string
  cupon?: string
  importeUSD: number
  categoria: "meta" | "otro"
}

interface ImpuestoDelResumen {
  id: string
  descripcion: string
  importeARS: number
  baseARS?: number
  computa: boolean
}

interface Verificacion {
  id: string
  descripcion: string
  ok: boolean
  detalle: string
}

interface Analisis {
  cierre: string | null
  cierreAnterior: string | null
  vencimiento: string | null
  tipoDeCambio: number | null
  lineas: LineaDelResumen[]
  totalDeclaradoUSD: number | null
  impuestos: ImpuestoDelResumen[]
  verificaciones: Verificacion[]
  problemas: string[]
}

interface TotalesDelResumen {
  cargosDeMetaUSD: number
  cargosFijosUSD: number
  consumoTotalUSD: number
  impuestosARS: number
  impuestosUSD: number
  excluidoARS: number
  totalUSD: number
}

interface ResumenGuardado {
  cierre: string
  cierreAnterior: string | null
  vencimiento: string | null
  periodoImputado: string
  tipoDeCambio: number | null
  cargosDeMetaUSD: number
  cargosFijosUSD: number
  impuestosARS: number
  impuestosUSD: number
  excluidoARS: number
  lineas: LineaDelResumen[]
  cargadoEl: string
}

interface FilaDeConciliacion {
  periodo: string
  mensajesConCargo: number | null
  computadoUSD: number | null
  imputadoUSD: number
  resumenes: string[]
  cargosFijosUSD: number
  saldoUSD: number | null
}

interface Conciliacion {
  desde: string
  filas: FilaDeConciliacion[]
  computadoAcumuladoUSD: number
  imputadoAcumuladoUSD: number
  saldoUSD: number | null
  mesesSinDato: string[]
  resumenesFueraDeRango: string[]
}

const mesLegible = (periodo: string) => {
  const [anio, mes] = periodo.split("-")
  const nombres = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
  return `${nombres[Number(mes) - 1] ?? mes} ${anio}`
}

const fechaLegible = (iso: string | null) => {
  if (!iso) return "—"
  // Sin `new Date`: con "2026-10-01" el constructor interpreta UTC y en
  // Argentina muestra el 30 de septiembre.
  const [anio, mes, dia] = iso.split("-")
  return `${dia}/${mes}/${anio}`
}

export function ConciliacionTarjeta({
  month,
  mensajesConCargo,
  onCostosFijos,
}: {
  month: string
  /**
   * Los mensajes con cargo del mes que se está mirando, tal como los muestra la
   * fila "Total general de todo".
   *
   * Viene de la pantalla y no del servidor a propósito: así la conciliación no
   * puede contradecir a la tabla que tiene arriba. Y el mes en curso no tiene
   * cierre guardado, así que el servidor no lo tendría de ninguna otra forma.
   *
   * `null` mientras las tablas no cargaron.
   */
  mensajesConCargo: number | null
  /**
   * Avisa el costo fijo del mes, con sus impuestos, para que el resultado se
   * muestre arriba —donde se mira el resultado— y no sólo acá.
   *
   * `null` mientras no se sabe. Cero es un valor válido: significa que no hay
   * ningún resumen imputado a este mes, y entonces el resultado del mes todavía
   * no incluye los costos fijos. Que eso se distinga de "no hay costos fijos"
   * lo resuelve quien lo muestra, con los resúmenes a la vista.
   */
  onCostosFijos?: (usd: number | null) => void
}) {
  const [resumenes, setResumenes] = useState<ResumenGuardado[]>([])
  const [conciliacion, setConciliacion] = useState<Conciliacion | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState("")
  const [analisis, setAnalisis] = useState<Analisis | null>(null)
  const [totales, setTotales] = useState<TotalesDelResumen | null>(null)
  const [categorias, setCategorias] = useState<Record<string, "meta" | "otro">>({})
  const [imputarA, setImputarA] = useState("")
  const [trabajando, setTrabajando] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)

  const antesDelCorte = month < COSTO_DESGLOSADO_DESDE

  const cargar = useCallback(async () => {
    if (antesDelCorte) {
      setCargando(false)
      return
    }
    setCargando(true)
    setError(null)
    try {
      const url =
        `/api/servicio/tarjeta?hasta=${encodeURIComponent(month)}` +
        (mensajesConCargo !== null ? `&mensajes=${mensajesConCargo}` : "")
      const r = await fetch(url)
      if (!r.ok) throw new Error("No se pudo leer la conciliación")
      const data = await r.json()
      setResumenes(data.resumenes || [])
      setConciliacion(data.conciliacion || null)
    } catch (err) {
      console.error("Error cargando la conciliación:", err)
      setError("No se pudo cargar la conciliación con la tarjeta.")
    } finally {
      setCargando(false)
    }
  }, [month, mensajesConCargo, antesDelCorte])

  useEffect(() => {
    cargar()
  }, [cargar])

  async function analizar(guardar: boolean) {
    setTrabajando(true)
    setMensaje(null)
    try {
      const r = await fetch("/api/servicio/tarjeta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          texto,
          categorias,
          guardar,
          periodoImputado: guardar ? imputarA || undefined : undefined,
        }),
      })
      const data = await r.json()
      if (data.analisis) setAnalisis(data.analisis)
      if (data.totales) setTotales(data.totales)
      if (!r.ok) {
        setMensaje(data.error || "No se pudo procesar el resumen.")
        return
      }
      if (guardar) {
        setMensaje(`Resumen del ${fechaLegible(data.guardado?.cierre)} guardado.`)
        setTexto("")
        setAnalisis(null)
        setTotales(null)
        setCategorias({})
        setAbierto(false)
        await cargar()
      } else if (data.analisis?.cierre) {
        setImputarA(String(data.analisis.cierre).slice(0, 7))
      }
    } catch (err) {
      console.error("Error procesando el resumen:", err)
      setMensaje("Error de red al procesar el resumen.")
    } finally {
      setTrabajando(false)
    }
  }

  async function borrar(cierre: string) {
    if (!confirm(`¿Borrar el resumen con cierre ${fechaLegible(cierre)}? El saldo se recalcula.`)) {
      return
    }
    await fetch(`/api/servicio/tarjeta?cierre=${encodeURIComponent(cierre)}`, { method: "DELETE" })
    await cargar()
  }

  /**
   * El costo fijo del mes, avisado al contenedor.
   *
   * Mismo patrón y mismo motivo que `onTotales` de FacturacionTable: el
   * callback va en un ref y las dependencias son números, para que un padre que
   * pase una función nueva en cada render no arme un bucle.
   */
  const delMesParaElAviso = conciliacion?.filas.find((f) => f.periodo === month)
  const fijosUSD = delMesParaElAviso ? delMesParaElAviso.cargosFijosUSD : null
  const avisar = useRef(onCostosFijos)
  useEffect(() => {
    avisar.current = onCostosFijos
  }, [onCostosFijos])
  useEffect(() => {
    if (!avisar.current) return
    // Con sus sellos: los servicios que no son Meta no pagan el IVA RG 4240
    // —verificado contra el resumen— pero sí sellos. Aplicarles el recargo
    // completo los haría un 21 % más caros de lo que son.
    avisar.current(
      fijosUSD === null || antesDelCorte ? null : fijosUSD + impuestosDeUnCargoFijo(month, fijosUSD),
    )
  }, [fijosUSD, month, antesDelCorte])

  if (antesDelCorte) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base">Conciliación con la tarjeta</CardTitle>
          <CardDescription>
            Arranca en {mesLegible(COSTO_DESGLOSADO_DESDE)}. Antes de ese mes el costo era un único
            valor por mensaje que no separa el cargo de Meta de sus impuestos, así que no hay con qué
            conciliar: el dato no existe.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const delMes = conciliacion?.filas.find((f) => f.periodo === month)

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="text-base">Conciliación con la tarjeta</CardTitle>
          <CardDescription>
            Lo que computamos contra lo que cobró la tarjeta, en dólares y sobre el cargo neto de
            Meta. Los períodos de la tarjeta son móviles, así que el mes suelto no cuadra: lo que
            cuadra es el acumulado, y la diferencia queda como saldo para el mes siguiente.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => setAbierto((v) => !v)}>
          {abierto ? "Cerrar" : "Cargar un resumen"}
        </Button>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* ── Cargar un resumen ──────────────────────────────────────────── */}
        {abierto && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <p className="text-sm font-medium">Pegá el texto del resumen</p>
            <p className="text-xs text-muted-foreground">
              Abrí el PDF, seleccioná todo y pegalo acá. Hace falta que vengan la fila de CIERRE
              ACTUAL, la sección de consumos con su TOTAL CONSUMOS y las líneas de impuestos: de ahí
              salen el período, el tipo de cambio y las verificaciones.
            </p>
            <Textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={6}
              placeholder="CIERRE ACTUAL  VENCIMIENTO ACTUAL …"
              className="font-mono text-xs"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => analizar(false)} disabled={trabajando || !texto.trim()}>
                {trabajando && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                Analizar
              </Button>
              {analisis && (
                <>
                  <span className="text-xs text-muted-foreground">Imputar al mes</span>
                  <Input
                    value={imputarA}
                    onChange={(e) => setImputarA(e.target.value)}
                    placeholder="YYYY-MM"
                    className="h-8 w-28"
                  />
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => analizar(true)}
                    disabled={trabajando || analisis.problemas.length > 0}
                    title={
                      analisis.problemas.length > 0
                        ? "No se puede guardar: hay verificaciones que no pasaron"
                        : undefined
                    }
                  >
                    Guardar
                  </Button>
                </>
              )}
            </div>

            {mensaje && <p className="text-xs font-medium">{mensaje}</p>}

            {/* ── Lo que entendió ─────────────────────────────────────────── */}
            {analisis && totales && (
              <div className="space-y-3 border-t pt-3">
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
                  <div>
                    <span className="block text-muted-foreground">Cierre</span>
                    {fechaLegible(analisis.cierre)}
                  </div>
                  <div>
                    <span className="block text-muted-foreground">Período desde</span>
                    {fechaLegible(analisis.cierreAnterior)}
                  </div>
                  <div>
                    <span className="block text-muted-foreground">Vencimiento</span>
                    {fechaLegible(analisis.vencimiento)}
                  </div>
                  <div>
                    <span className="block text-muted-foreground">Dólar del resumen</span>
                    {analisis.tipoDeCambio ? formatoARS.format(analisis.tipoDeCambio) : "—"}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
                  <div>
                    <span className="block text-muted-foreground">Cargos de Meta</span>
                    <span className="font-semibold">{formatoUSD.format(totales.cargosDeMetaUSD)}</span>
                  </div>
                  <div>
                    <span className="block text-muted-foreground">Costos fijos</span>
                    <span className="font-semibold">{formatoUSD.format(totales.cargosFijosUSD)}</span>
                  </div>
                  <div>
                    <span className="block text-muted-foreground">Impuestos</span>
                    <span className="font-semibold">{formatoUSD.format(totales.impuestosUSD)}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {formatoARS.format(totales.impuestosARS)}
                    </span>
                  </div>
                  <div>
                    <span className="block text-muted-foreground">Total del resumen</span>
                    <span className="font-semibold">{formatoUSD.format(totales.totalUSD)}</span>
                  </div>
                </div>

                {/* Las verificaciones primero: son lo que decide si se guarda. */}
                <ul className="space-y-1 text-xs">
                  {analisis.verificaciones.map((v) => (
                    <li key={v.id} className={v.ok ? "text-muted-foreground" : "text-destructive"}>
                      {v.ok ? "✓" : "✗"} {v.descripcion} — {v.detalle}
                    </li>
                  ))}
                </ul>

                {analisis.problemas.length > 0 && (
                  <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                    <p className="font-medium">No se puede guardar:</p>
                    <ul className="mt-1 list-inside list-disc">
                      {analisis.problemas.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {totales.excluidoARS !== 0 && (
                  <p className="rounded border bg-background p-2 text-[11px] text-muted-foreground">
                    Se encontró la percepción RG 5617 por {formatoARS.format(totales.excluidoARS)} y
                    NO se computa: la tarjeta la debita y la acredita entera en el resumen
                    siguiente. Se menciona para que no parezca que se perdió una línea.
                  </p>
                )}

                {/* Las líneas, con su categoría corregible. Los descriptores de
                    Meta son opacos, así que la clasificación es un default. */}
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">
                    Ver las {analisis.lineas.length} líneas de consumo
                  </summary>
                  <Table className="mt-2">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="h-8">Fecha</TableHead>
                        <TableHead className="h-8">Descripción</TableHead>
                        <TableHead className="h-8 text-right">USD</TableHead>
                        <TableHead className="h-8">Categoría</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analisis.lineas.map((l, i) => {
                        const id = l.cupon ?? `#${i}`
                        const actual = categorias[id] ?? l.categoria
                        return (
                          <TableRow key={id}>
                            <TableCell className="py-1">{fechaLegible(l.fecha)}</TableCell>
                            <TableCell className="py-1 font-mono">{l.descripcion}</TableCell>
                            <TableCell className="py-1 text-right">
                              {formatoUSD.format(l.importeUSD)}
                            </TableCell>
                            <TableCell className="py-1">
                              <button
                                type="button"
                                className="rounded border px-1.5 py-0.5 text-[10px] hover:bg-muted"
                                onClick={() =>
                                  setCategorias((prev) => ({
                                    ...prev,
                                    [id]: actual === "meta" ? "otro" : "meta",
                                  }))
                                }
                                title="Cambiar entre mensajes de Meta y costo fijo"
                              >
                                {actual === "meta" ? "Meta" : "Costo fijo"}
                              </button>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Si cambiás alguna categoría, volvé a apretar Analizar: el tipo de cambio y las
                    verificaciones se recalculan con la clasificación nueva.
                  </p>
                </details>
              </div>
            )}
          </div>
        )}

        {/* ── La cuenta corriente ────────────────────────────────────────── */}
        {cargando ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="py-4 text-center text-sm text-destructive">{error}</p>
        ) : !conciliacion || conciliacion.filas.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Todavía no hay meses para conciliar.
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mes</TableHead>
                  <TableHead className="text-right">Mensajes con cargo</TableHead>
                  <TableHead className="text-right">Computado (Meta)</TableHead>
                  <TableHead className="text-right">Cobró la tarjeta</TableHead>
                  <TableHead className="text-right">Costos fijos</TableHead>
                  <TableHead className="text-right">Saldo acumulado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {conciliacion.filas.map((f) => (
                  <TableRow key={f.periodo} className={f.periodo === month ? "bg-muted/50" : ""}>
                    <TableCell>
                      {mesLegible(f.periodo)}
                      {f.resumenes.length > 0 && (
                        <span className="block text-[10px] text-muted-foreground">
                          resumen{f.resumenes.length === 1 ? "" : "es"} del{" "}
                          {f.resumenes.map(fechaLegible).join(", ")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {f.mensajesConCargo === null ? (
                        <span className="text-destructive" title="Nadie abrió Facturación ese mes, así que el dato no quedó guardado">
                          sin dato
                        </span>
                      ) : (
                        f.mensajesConCargo.toLocaleString("es-AR")
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {f.computadoUSD === null ? "—" : formatoUSD.format(f.computadoUSD)}
                    </TableCell>
                    <TableCell className="text-right">
                      {f.imputadoUSD === 0 ? (
                        <span className="text-muted-foreground">sin resumen</span>
                      ) : (
                        formatoUSD.format(f.imputadoUSD)
                      )}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {f.cargosFijosUSD === 0 ? "—" : formatoUSD.format(f.cargosFijosUSD)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-medium ${
                        f.saldoUSD !== null && f.saldoUSD < 0 ? "text-destructive" : ""
                      }`}
                    >
                      {f.saldoUSD === null ? "—" : formatoUSD.format(f.saldoUSD)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-primary/5 font-semibold">
                  <TableCell>Acumulado</TableCell>
                  <TableCell />
                  <TableCell className="text-right">
                    {formatoUSD.format(conciliacion.computadoAcumuladoUSD)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatoUSD.format(conciliacion.imputadoAcumuladoUSD)}
                  </TableCell>
                  <TableCell />
                  <TableCell
                    className={`text-right ${
                      conciliacion.saldoUSD !== null && conciliacion.saldoUSD < 0
                        ? "text-destructive"
                        : ""
                    }`}
                  >
                    {conciliacion.saldoUSD === null ? "—" : formatoUSD.format(conciliacion.saldoUSD)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>

            <p className="text-xs text-muted-foreground">
              Saldo positivo = mensajes ya computados que la tarjeta todavía no cobró, normalmente
              porque el período del resumen cerró antes que el mes. Negativo = el resumen abarcó
              consumo anterior al primer mes conciliado. En los dos casos se arrastra y se compensa
              solo.
            </p>

            {conciliacion.mesesSinDato.length > 0 && (
              <p className="rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-xs text-amber-900">
                No hay mensajes guardados para {conciliacion.mesesSinDato.map(mesLegible).join(", ")}
                , así que el saldo acumulado no se puede afirmar y queda en blanco. Se arregla
                abriendo esos meses en la pestaña Facturación, que es lo que congela el dato.
              </p>
            )}

            {conciliacion.resumenesFueraDeRango.length > 0 && (
              <p className="rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-xs text-amber-900">
                Hay resúmenes imputados a meses que no entran en este rango (
                {conciliacion.resumenesFueraDeRango.map(fechaLegible).join(", ")}): no suman acá.
                Suele ser un mes de imputación mal escrito al cargarlos.
              </p>
            )}

            {/* El costo fijo del mes, dicho aparte: no es costo por mensaje y no
                se puede repartir por cliente —Vercel y Upstash no escalan con
                los mensajes de una clínica—, así que se resta del resultado
                general y no de ninguna fila. */}
            {delMes && delMes.cargosFijosUSD > 0 && (
              <p className="text-xs">
                <span className="font-medium">Costos fijos de {mesLegible(month)}:</span>{" "}
                {formatoUSD.format(delMes.cargosFijosUSD)} de servicios que no son Meta (Vercel,
                OpenAI, Upstash). No se reparten por clínica: se restan del resultado general.
              </p>
            )}
          </>
        )}

        {/* ── Los resúmenes cargados ─────────────────────────────────────── */}
        {resumenes.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Resúmenes cargados ({resumenes.length})
            </summary>
            <Table className="mt-2">
              <TableHeader>
                <TableRow>
                  <TableHead className="h-8">Cierre</TableHead>
                  <TableHead className="h-8">Imputado a</TableHead>
                  <TableHead className="h-8 text-right">Meta</TableHead>
                  <TableHead className="h-8 text-right">Fijos</TableHead>
                  <TableHead className="h-8 text-right">Impuestos</TableHead>
                  <TableHead className="h-8 text-right">Dólar</TableHead>
                  <TableHead className="h-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {resumenes.map((r) => (
                  <TableRow key={r.cierre}>
                    <TableCell className="py-1 text-xs">
                      {fechaLegible(r.cierre)}
                      <span className="block text-[10px] text-muted-foreground">
                        desde {fechaLegible(r.cierreAnterior)} · {r.lineas.length} líneas
                      </span>
                    </TableCell>
                    <TableCell className="py-1 text-xs">{mesLegible(r.periodoImputado)}</TableCell>
                    <TableCell className="py-1 text-right text-xs">
                      {formatoUSD.format(r.cargosDeMetaUSD)}
                    </TableCell>
                    <TableCell className="py-1 text-right text-xs">
                      {formatoUSD.format(r.cargosFijosUSD)}
                    </TableCell>
                    <TableCell className="py-1 text-right text-xs">
                      {formatoUSD.format(r.impuestosUSD)}
                    </TableCell>
                    <TableCell className="py-1 text-right text-xs">
                      {r.tipoDeCambio ? formatoARS.format(r.tipoDeCambio) : "—"}
                    </TableCell>
                    <TableCell className="py-1 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => borrar(r.cierre)}
                        title="Borrar este resumen"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </details>
        )}
      </CardContent>
    </Card>
  )
}
