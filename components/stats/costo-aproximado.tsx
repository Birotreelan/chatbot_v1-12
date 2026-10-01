"use client"

/**
 * El recuadro de "Costo aproximado" dentro de Total de Interacciones.
 *
 * Es un componente propio y no dos bloques de JSX copiados porque la tarjeta de
 * interacciones existe dos veces —el panel que ve la clínica en /stats y el que
 * vemos nosotros en /dashboard/estadisticas— y tienen que decir el mismo
 * número. Si uno se actualiza y el otro no, el día que alguien pregunte por qué
 * no coinciden ya no se va a saber cuál está bien.
 *
 * Carga su propio dato en vez de recibirlo: las dos pantallas lo usan igual, y
 * pasarlo por props obligaría a repetir el `fetch`, el estado de carga y el
 * manejo del error en las dos.
 */

import { useEffect, useState } from "react"
import { DollarSign, Loader2 } from "lucide-react"

interface Costo {
  precioUnitarioUsd: number
  precioPropio: boolean
  dolarVenta: number | null
}

const pesos = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
})

const dolares = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function CostoAproximado({
  clienteId,
  interacciones,
  cargandoInteracciones,
}: {
  clienteId: string
  interacciones: number
  /** El total todavía se está trayendo: no mostrar un costo de cero. */
  cargandoInteracciones?: boolean
}) {
  const [costo, setCosto] = useState<Costo | null>(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vigente = true
    setCargando(true)

    fetch(`/api/appointment-stats/costo?cliente_id=${encodeURIComponent(clienteId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!vigente) return
        if (data?.exito) setCosto(data as Costo)
      })
      .catch(() => {})
      .finally(() => {
        if (vigente) setCargando(false)
      })

    // La cotización no cambia con el filtro de fechas, así que esto corre una
    // sola vez por cliente y no en cada cambio de período.
    return () => {
      vigente = false
    }
  }, [clienteId])

  const esperando = cargando || cargandoInteracciones

  const totalUsd = costo ? interacciones * costo.precioUnitarioUsd : 0
  const totalPesos = costo?.dolarVenta ? totalUsd * costo.dolarVenta : null

  return (
    <div className="text-center p-4 bg-white rounded-lg border border-purple-100">
      <DollarSign className="h-6 w-6 text-purple-500 mx-auto mb-2" />

      {esperando ? (
        <div className="flex h-9 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !costo ? (
        // Sin precio no hay nada que mostrar, y un guion es más honesto que un
        // cero: cero pesos se lee como "no te estamos cobrando".
        <div className="text-3xl font-bold text-purple-600">—</div>
      ) : (
        <div className="text-3xl font-bold text-purple-600">
          {totalPesos !== null ? pesos.format(totalPesos) : dolares.format(totalUsd)}
        </div>
      )}

      <div className="text-sm text-muted-foreground mt-1">Costo aproximado</div>

      {!esperando && costo && (
        <p className="mt-1 text-xs text-muted-foreground">
          {totalPesos !== null ? (
            <>
              {dolares.format(totalUsd)} · dólar venta {pesos.format(costo.dolarVenta as number)}
            </>
          ) : (
            // Se dice por qué está en dólares. Sin esto, la clínica que un día
            // ve pesos y otro ve dólares va a pensar que algo se rompió.
            <>No pudimos obtener la cotización del dólar</>
          )}
        </p>
      )}
    </div>
  )
}
