"use client"

import { useState, useEffect, useCallback } from "react"
import { MonthSelector, getCurrentMonthValue } from "./month-selector"
import { esReglaAnterior, reglaDelPeriodo, REGLAS } from "@/lib/facturacion-reglas"
import { FacturacionTable } from "./facturacion-table"

const formatoUSD = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function FacturacionSection() {
  const [month, setMonth] = useState<string>(getCurrentMonthValue())
  const [dolarVenta, setDolarVenta] = useState<number | null>(null)

  const loadDolar = useCallback(async () => {
    try {
      const response = await fetch("/api/facturacion/dolar")
      if (response.ok) {
        const data = await response.json()
        setDolarVenta(typeof data.dolarVenta === "number" ? data.dolarVenta : null)
      }
    } catch (err) {
      console.error("Error cargando cotización del dólar:", err)
    }
  }, [])

  useEffect(() => {
    loadDolar()
  }, [loadDolar])

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
          <span className="text-sm text-muted-foreground">Dolar Venta</span>
          <span className="text-sm font-semibold">
            {dolarVenta ? `$${formatoUSD.format(dolarVenta)}` : "—"}
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

      <FacturacionTable month={month} dolarVenta={dolarVenta} />

      <FacturacionTable
        title="Facturación de clientes Wpp sin IA"
        apiPath="/api/facturacion/interacciones-sin-ia"
        cantidadLabel="Mensajes pagados"
        month={month}
        dolarVenta={dolarVenta}
      />
    </div>
  )
}
