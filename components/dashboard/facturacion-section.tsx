"use client"

import { useState, useEffect, useCallback } from "react"
import { MonthSelector, getCurrentMonthValue } from "./month-selector"
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
