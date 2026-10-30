"use client"

/**
 * La pestaña "Servicio" (16/10/2026).
 *
 * ── Es una copia deliberada de FacturacionSection ──────────────────────────
 *
 * Hoy muestra exactamente lo mismo que Facturación: así lo pidió Nicolás para
 * arrancar. La copia es a propósito y no un descuido — la alternativa era
 * renderizar el mismo componente y separarlos cuando aparezca la primera
 * diferencia, y se eligió tenerlos separados desde el principio para poder
 * tocar Servicio sin pensar en Facturación.
 *
 * La contrapartida hay que decirla: mientras sigan siendo iguales, cualquier
 * arreglo en una de las dos hay que repetirlo en la otra a mano. Si pasan
 * semanas y no divergen, lo barato es volver a unirlas.
 *
 * Lo que NO se copió es `FacturacionTable`: es infraestructura parametrizada
 * —recibe título, endpoint y etiqueta— y duplicarla serían 500 líneas que
 * tendrían que cambiar juntas siempre. Cuando Servicio necesite otra tabla, le
 * pasa otros parámetros o se copia ahí.
 *
 * ── Quién la ve ────────────────────────────────────────────────────────────
 *
 * Sólo `super_admin`: vive dentro de /dashboard, y el layout de esa área exige
 * ese rol. Un `billing_agent` entra a /facturacion y no al dashboard, así que
 * no la ve — que es la condición que puso Nicolás. Si algún día hace falta que
 * alguien vea Servicio sin ser super_admin, eso es un área propia con su rol,
 * como /facturacion, y no aflojar el layout del dashboard.
 */

import { useState, useEffect, useCallback } from "react"
import { MonthSelector, getCurrentMonthValue } from "./month-selector"
import { esReglaAnterior, reglaDelPeriodo, REGLAS } from "@/lib/facturacion-reglas"
import { FacturacionTable, type TotalesDeLaTabla } from "./facturacion-table"
import { GranTotalServicio } from "./gran-total-servicio"
import { Input } from "@/components/ui/input"
import { servicioUsaValoresPropios, SERVICIO_PRECIO_PROPIO_DESDE } from "@/lib/servicio-calculo"

const formatoUSD = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function ServicioSection() {
  const [month, setMonth] = useState<string>(getCurrentMonthValue())
  const [dolarVivo, setDolarVivo] = useState<number | null>(null)
  const [dolarCongelado, setDolarCongelado] = useState<number | null>(null)
  const [mesCerrado, setMesCerrado] = useState(false)
  const [cotizacionDudosa, setCotizacionDudosa] = useState(false)

  /**
   * El dólar propio de Servicio para este mes: el que alguien fijó, o `null`
   * si nadie lo hizo y se usa el vivo.
   *
   * `textoDolar` es aparte del número porque mientras se tipea "15" el valor
   * no es todavía un dólar válido, y recalcular toda la tabla con 15 pesos en
   * cada tecla sería ruido — y dejaría números absurdos a la vista.
   */
  /**
   * Los totales de cada tabla, para poder sumarlos (30/10/2026).
   *
   * Los reporta cada `FacturacionTable` desde su propia fila de totales, así
   * que el gran total es la suma de lo que está en pantalla y no un segundo
   * cálculo paralelo. `null` mientras esa tabla no haya cargado: ver
   * GranTotalServicio, que en ese caso no suma.
   *
   * Los dos `useCallback` son necesarios, no decoración: sin ellos la función
   * sería nueva en cada render y la tabla volvería a avisar en cada uno.
   */
  const [totalesConIA, setTotalesConIA] = useState<TotalesDeLaTabla | null>(null)
  const [totalesSinIA, setTotalesSinIA] = useState<TotalesDeLaTabla | null>(null)
  const recibirConIA = useCallback((t: TotalesDeLaTabla | null) => setTotalesConIA(t), [])
  const recibirSinIA = useCallback((t: TotalesDeLaTabla | null) => setTotalesSinIA(t), [])

  const [dolarFijado, setDolarFijado] = useState<number | null>(null)
  const [textoDolar, setTextoDolar] = useState("")
  const [guardandoDolar, setGuardandoDolar] = useState(false)

  const loadDolar = useCallback(async () => {
    try {
      const response = await fetch("/api/facturacion/dolar")
      if (response.ok) {
        const data = await response.json()
        setDolarVivo(typeof data.dolarVenta === "number" ? data.dolarVenta : null)
      }
    } catch (err) {
      console.error("Error cargando cotización del dólar:", err)
    }
  }, [])

  /**
   * La cotización con la que quedó cerrado el mes que se está mirando.
   *
   * Antes el encabezado mostraba siempre el dólar de hoy, incluso mirando
   * septiembre: las filas usaban el congelado y el recuadro de arriba el
   * actual, y quien lo leía no tenía forma de saber cuál manda. Ahora el
   * encabezado dice el mismo que usan las filas.
   */
  const loadCierre = useCallback(async () => {
    setDolarCongelado(null)
    setMesCerrado(false)
    setCotizacionDudosa(false)
    try {
      const r = await fetch(`/api/facturacion/cierre?mes=${encodeURIComponent(month)}`)
      if (!r.ok) return
      const data = await r.json()
      if (data?.cerrado) {
        setMesCerrado(true)
        setDolarCongelado(typeof data.dolarVenta === "number" ? data.dolarVenta : null)
        setCotizacionDudosa(Boolean(data.cotizacionFueraDePeriodo))
      }
    } catch {
      // Sin esta información se muestra el dólar vivo, que es el comportamiento
      // anterior: no vale la pena avisar nada.
    }
  }, [month])

  useEffect(() => {
    loadDolar()
  }, [loadDolar])

  useEffect(() => {
    loadCierre()
  }, [loadCierre])

  const loadDolarServicio = useCallback(async () => {
    setDolarFijado(null)
    setTextoDolar("")
    if (!servicioUsaValoresPropios(month)) return
    try {
      const r = await fetch(`/api/servicio/dolar?mes=${encodeURIComponent(month)}`)
      if (!r.ok) return
      const data = await r.json()
      const fijado = typeof data.fijado === "number" ? data.fijado : null
      setDolarFijado(fijado)
      setTextoDolar(fijado !== null ? String(fijado) : "")
    } catch {
      // Sin esto se usa el dólar vivo, que es lo mismo que cuando nadie fijó
      // nada. No hay nada que avisar.
    }
  }, [month])

  useEffect(() => {
    loadDolarServicio()
  }, [loadDolarServicio])

  const guardarDolar = async () => {
    const crudo = textoDolar.trim()
    const valor = crudo === "" ? null : Number(crudo)
    if (valor !== null && (!Number.isFinite(valor) || valor <= 0)) {
      // Entrada inválida: se vuelve a lo guardado en vez de mandar basura.
      setTextoDolar(dolarFijado !== null ? String(dolarFijado) : "")
      return
    }
    setGuardandoDolar(true)
    try {
      const r = await fetch("/api/servicio/dolar", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes: month, valor }),
      })
      if (r.ok) {
        const data = await r.json()
        const fijado = typeof data.fijado === "number" ? data.fijado : null
        setDolarFijado(fijado)
        setTextoDolar(fijado !== null ? String(fijado) : "")
      }
    } catch (err) {
      console.error("Error guardando el dólar de Servicio:", err)
    } finally {
      setGuardandoDolar(false)
    }
  }

  /**
   * El dólar con el que calcula esta pestaña.
   *
   * Desde octubre de 2026 manda el de Servicio: el fijado si hay uno, y si no
   * el vivo. Antes de ese corte se usa el del cierre de Facturación, para que
   * los meses ya facturados den exactamente lo mismo en las dos pestañas.
   * Ver lib/servicio-calculo.ts.
   */
  const valoresPropios = servicioUsaValoresPropios(month)
  const dolarVenta = valoresPropios
    ? (dolarFijado ?? dolarVivo)
    : (mesCerrado ? dolarCongelado : dolarVivo)

  const esMesEnCurso = month === getCurrentMonthValue()

  // La regla que rige para el mes que se está mirando. Sale del registro de
  // lib/facturacion-reglas.ts, no de un `if` con fechas acá: cuando se agregue
  // el próximo cambio, esta pantalla no se toca.
  const regla = reglaDelPeriodo(month)
  const conReglaAnterior = esReglaAnterior(month)

  return (
    <div className="space-y-10">
      <div className="flex items-center gap-3">
        <MonthSelector value={month} onChange={setMonth} />
        {esMesEnCurso && <span className="text-sm font-semibold text-red-600">Consumo en curso</span>}
        {/* En Servicio el dólar se edita: es uno de los dos valores propios de
            la pestaña. Vacío = usar el del día. Antes del corte de octubre el
            campo no aparece, porque esos meses muestran lo de Facturación y
            dejar un editor que no cambia nada sería mentir. */}
        <div className="ml-auto flex items-center gap-2 rounded-lg border bg-muted/50 px-4 py-2">
          <span className="text-sm text-muted-foreground">
            {valoresPropios ? "Dólar venta" : "Dólar del cierre"}
          </span>
          {valoresPropios ? (
            <>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder={dolarVivo ? formatoUSD.format(dolarVivo) : "—"}
                className="h-8 w-28 text-right"
                value={textoDolar}
                onChange={(e) => setTextoDolar(e.target.value)}
                onBlur={guardarDolar}
                disabled={guardandoDolar}
              />
              <span
                className={`rounded px-1.5 py-0.5 text-xs ${
                  dolarFijado !== null
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
                title={
                  dolarFijado !== null
                    ? "Este mes usa el valor fijado acá. Borralo para volver al dólar del día."
                    : "Nadie fijó un valor: se usa el dólar del día."
                }
              >
                {dolarFijado !== null ? "fijado" : "del día"}
              </span>
            </>
          ) : (
            <>
              <span className="text-sm font-semibold">
                {dolarVenta ? `$${formatoUSD.format(dolarVenta)}` : "—"}
              </span>
              {mesCerrado && (
                <span
                  className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary"
                  title="La cotización de este mes quedó fija al cerrarse. El dólar de hoy no lo afecta."
                >
                  fijo
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Con qué regla se calculó este mes (7/10/2026) ──────────────────
          Van a venir más cambios de cálculo, y un total sin la regla al lado
          es un número que no se puede defender: tres meses después nadie se
          acuerda de qué se contaba. El aviso cambia de tono según el caso
          —histórico o vigente— porque son dos lecturas distintas: en uno hay
          que entender un número viejo, en el otro verificar el actual. */}
      <div
        className={`rounded-lg border px-4 py-3 text-sm ${
          conReglaAnterior ? "border-amber-500/40 bg-amber-500/5" : "border-primary/30 bg-primary/5"
        }`}
      >
        <p className="font-medium">
          {conReglaAnterior ? "Este mes se calculó con una regla anterior" : "Cálculo vigente"}
          {" · "}
          <span className="font-normal text-muted-foreground">{regla.nombre}</span>
        </p>
        <p className="mt-1 text-muted-foreground">{regla.queSeCuenta}</p>
        {regla.queCambio && (
          <p className="mt-1 text-muted-foreground">
            <span className="font-medium">Qué cambió:</span> {regla.queCambio}
          </p>
        )}
        {/* Ser honesto con esto importa más que verse prolijo: el cierre usa
            el dólar del día en que alguien abrió el mes por primera vez, y si
            eso pasó mucho después, el número no tiene relación con el período
            facturado. Nunca guardamos cotizaciones históricas, así que no se
            puede corregir solo — pero sí se puede no presentarlo como si fuera
            el dólar del mes. */}
        {cotizacionDudosa && (
          <p className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-900">
            La cotización fija de este mes es la del día en que se cerró, no la del período. Si
            necesitás el dólar que correspondía, hay que corregirlo a mano.
          </p>
        )}

        {/* El corte propio de Servicio. Sin esto, alguien abre septiembre,
            ve el mismo total que en Facturación, y no tiene forma de saber si
            es porque los precios coinciden o porque ese mes no usa el suyo. */}
        {!valoresPropios && (
          <p className="mt-2 rounded border border-primary/30 bg-primary/5 px-2 py-1.5 text-xs">
            Este período se muestra igual que en Facturación: mismo valor por unidad y mismo
            dólar. Servicio calcula con sus propios valores desde{" "}
            {SERVICIO_PRECIO_PROPIO_DESDE.replace("-", "/")} en adelante.
          </p>
        )}

        {conReglaAnterior && (
          <p className="mt-2 text-xs text-muted-foreground">
            Los meses anteriores se siguen mostrando con la regla que tenían: si se recalcularan con
            la actual, dejarían de coincidir con las facturas ya emitidas.
          </p>
        )}

        {/* El historial entero, plegado. Sirve para la conversación que
            inevitablemente aparece —"¿desde cuándo cambió?"— sin ocupar
            lugar el 99% del tiempo. */}
        {REGLAS.length > 1 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Ver todas las reglas de cálculo ({REGLAS.length})
            </summary>
            <ul className="mt-2 space-y-2 text-xs text-muted-foreground">
              {REGLAS.map((r) => (
                <li key={r.id} className={r.id === regla.id ? "font-medium text-foreground" : ""}>
                  <span className="font-medium">{r.nombre}:</span> {r.queSeCuenta}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {/* Servicio no muestra Alias ni CUIT —son de Facturación—, y suma la
          columna de Costo (sólo de esta pestaña desde el 27/10/2026) y una
          Observación por cliente. Son props de la misma tabla: ver la nota de
          FacturacionTableProps sobre por qué no se copió. */}
      {/* ── Lo que Servicio hace distinto ────────────────────────────────
          · sus propios precios (`apiPathPrecios`)
          · no cierra meses (`cerrarMes={false}`): leer no puede congelar un
            período desde una pestaña que no factura
          · desde octubre usa su precio y su dólar aunque el mes esté cerrado
            (`usarValoresPropios`); las UNIDADES siguen saliendo del cierre,
            que es lo que mantiene los conteos idénticos a Facturación */}
      <FacturacionTable
        title="Clientes Wpp con IA"
        month={month}
        dolarVenta={dolarVenta}
        mostrarAliasYCuit={false}
        mostrarCosto
        mostrarObservacion
        apiPathPrecios="/api/servicio/precios"
        cerrarMes={false}
        usarValoresPropios={valoresPropios}
        mostrarMargen
        onTotales={recibirConIA}
      />

      <FacturacionTable
        title="Clientes Wpp sin IA"
        apiPath="/api/facturacion/interacciones-sin-ia"
        cantidadLabel="Mensajes pagados"
        month={month}
        dolarVenta={dolarVenta}
        mostrarAliasYCuit={false}
        mostrarCosto
        mostrarObservacion
        apiPathPrecios="/api/servicio/precios"
        cerrarMes={false}
        usarValoresPropios={valoresPropios}
        mostrarMargen
        onTotales={recibirSinIA}
      />

      {/* ── El total de las dos tablas (30/10/2026) ───────────────────────
          Va al final y no arriba: es la suma de los dos totales generales que
          quedaron justo encima, y leerlo antes de ver los sumandos no diría
          nada. Los números salen de las tablas, no de una segunda consulta:
          ver gran-total-servicio.tsx. */}
      <GranTotalServicio
        partes={[
          { etiqueta: "Clientes Wpp con IA", totales: totalesConIA },
          { etiqueta: "Clientes Wpp sin IA", totales: totalesSinIA },
        ]}
      />
    </div>
  )
}
