"use client"

import { useState, useEffect, useCallback } from "react"
import { MonthSelector, getCurrentMonthValue } from "./month-selector"
import { esReglaAnterior, reglaDelPeriodo, REGLAS } from "@/lib/facturacion-reglas"
import { FacturacionTable } from "./facturacion-table"
import { Input } from "@/components/ui/input"

const formatoUSD = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function FacturacionSection() {
  const [month, setMonth] = useState<string>(getCurrentMonthValue())
  const [dolarVivo, setDolarVivo] = useState<number | null>(null)
  const [dolarCongelado, setDolarCongelado] = useState<number | null>(null)
  const [mesCerrado, setMesCerrado] = useState(false)
  const [cotizacionDudosa, setCotizacionDudosa] = useState(false)

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

  /**
   * El dólar del mes, editable (2/11/2026).
   *
   * ── Dónde vive, según el mes ─────────────────────────────────────────────
   *
   * Mes CERRADO: en el cierre. Editarlo corrige el cierre de todos los
   * clientes de ese mes —es por mes y no por cliente, por lo mismo que reabrir:
   * el cierre es una foto, y unas filas con un dólar y otras con otro harían
   * que el total general no se pueda comparar con nada—.
   *
   * Mes ABIERTO: en `facturacion:dolar:<mes>`, y si nadie lo fijó, el del día.
   *
   * Son dos lugares porque el número de un mes cerrado ya tiene su lugar, y
   * agregarle una capa de override encima daría dos respuestas a "¿con qué
   * dólar se facturó septiembre?". Para el que edita es un solo campo.
   */
  const [dolarFijado, setDolarFijado] = useState<number | null>(null)
  const [textoDolar, setTextoDolar] = useState("")
  const [guardandoDolar, setGuardandoDolar] = useState(false)
  // Sube cada vez que se corrige el dólar de un mes cerrado: la tabla lo recibe
  // como `recargar` y vuelve a pedir el mes, así las filas usan el valor nuevo.
  const [version, setVersion] = useState(0)

  const loadDolarDelMes = useCallback(async () => {
    setDolarFijado(null)
    setTextoDolar("")
    try {
      const r = await fetch(`/api/facturacion/dolar-mes?mes=${encodeURIComponent(month)}`)
      if (!r.ok) return
      const data = await r.json()
      const fijado = typeof data.fijado === "number" ? data.fijado : null
      setDolarFijado(fijado)
      setTextoDolar(fijado !== null ? String(fijado) : "")
    } catch {
      // Sin esto se usa el dólar del día, que es lo mismo que cuando nadie
      // fijó nada. No hay nada que avisar.
    }
  }, [month])

  useEffect(() => {
    loadDolarDelMes()
  }, [loadDolarDelMes])

  // El que se usa para calcular y para mostrar: en un mes cerrado, el suyo.
  const dolarVenta = mesCerrado ? dolarCongelado : (dolarFijado ?? dolarVivo)

  // El texto del campo: en un mes cerrado arranca del cierre, no del fijado.
  const textoVisible = mesCerrado
    ? (textoDolar !== "" ? textoDolar : dolarCongelado !== null ? String(dolarCongelado) : "")
    : textoDolar

  const guardarDolar = async () => {
    const crudo = textoVisible.trim()
    const valor = crudo === "" ? null : Number(crudo)
    if (valor !== null && (!Number.isFinite(valor) || valor <= 0)) {
      setTextoDolar(dolarFijado !== null ? String(dolarFijado) : "")
      return
    }
    // Sin cambios no se manda nada: si no, cualquier clic afuera del campo
    // reescribiría el cierre de todos los clientes del mes.
    if (mesCerrado && valor === dolarCongelado) return
    if (!mesCerrado && valor === dolarFijado) return

    setGuardandoDolar(true)
    try {
      if (mesCerrado) {
        const r = await fetch("/api/facturacion/cierre", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mes: month, dolarVenta: valor }),
        })
        if (!r.ok) throw new Error("No se pudo corregir el dólar del cierre")
        setDolarCongelado(valor)
        setTextoDolar(valor !== null ? String(valor) : "")
        // La tabla tiene el cierre viejo en memoria: hay que que lo vuelva a pedir.
        setVersion((v) => v + 1)
      } else {
        const r = await fetch("/api/facturacion/dolar-mes", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mes: month, valor }),
        })
        if (!r.ok) throw new Error("No se pudo fijar el dólar del mes")
        const data = await r.json()
        const fijado = typeof data.fijado === "number" ? data.fijado : null
        setDolarFijado(fijado)
        setTextoDolar(fijado !== null ? String(fijado) : "")
      }
    } catch (err) {
      console.error("Error guardando el dólar de Facturación:", err)
    } finally {
      setGuardandoDolar(false)
    }
  }

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
        <div className="ml-auto flex items-center gap-2 rounded-lg border bg-muted/50 px-4 py-2">
          <span className="text-sm text-muted-foreground">
            {mesCerrado ? "Dólar del cierre" : "Dolar Venta"}
          </span>
          {/* Editable (2/11/2026). Antes era texto, y la única forma de
              arreglar una cotización mal congelada era reabrir el mes entero
              —que lo recalcula con los datos de hoy—. En un mes abierto, vacío
              = usar el del día. */}
          <Input
            type="number"
            step="0.01"
            min="0"
            placeholder={dolarVivo ? formatoUSD.format(dolarVivo) : "—"}
            className="h-8 w-28 text-right"
            value={textoVisible}
            onChange={(e) => setTextoDolar(e.target.value)}
            onBlur={guardarDolar}
            disabled={guardandoDolar}
            title={
              mesCerrado
                ? "El dólar con el que quedó cerrado el mes. Al cambiarlo se corrigen los cierres de todos los clientes de este mes."
                : "Vacío = se usa el dólar del día."
            }
          />
          <span
            className={`rounded px-1.5 py-0.5 text-xs ${
              mesCerrado || dolarFijado !== null
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            }`}
            title={
              mesCerrado
                ? "La cotización de este mes quedó fija al cerrarse. El dólar de hoy no lo afecta."
                : dolarFijado !== null
                  ? "Este mes usa el valor fijado acá. Borralo para volver al dólar del día."
                  : "Nadie lo fijó: se usa el dólar del día."
            }
          >
            {mesCerrado ? "del cierre" : dolarFijado !== null ? "fijado" : "del día"}
          </span>
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

      <FacturacionTable month={month} dolarVenta={dolarVenta} recargar={version} />

      <FacturacionTable
        title="Facturación de clientes Wpp sin IA"
        apiPath="/api/facturacion/interacciones-sin-ia"
        cantidadLabel="Mensajes pagados"
        month={month}
        dolarVenta={dolarVenta}
        recargar={version}
      />
    </div>
  )
}
