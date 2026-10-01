"use client"

/**
 * La tarjeta "Total de Interacciones" (1/10/2026).
 *
 * ── Por qué es un componente ───────────────────────────────────────────────
 *
 * Existía dos veces, carácter por carácter: en el panel que ve la clínica
 * (components/stats/appointment-stats-view.tsx) y en el nuestro
 * (components/dashboard/appointment-stats-detail.tsx). Al agregar el costo
 * aproximado hubo que tocar las dos, y al corregir los loaders, otra vez las
 * dos. La tercera vez alguien se olvida de una y los dos paneles empiezan a
 * mostrar números distintos del mismo mes.
 *
 * ── Los loaders ────────────────────────────────────────────────────────────
 *
 * Los cuatro valores dependen de `mensajesPagados`, que llega de un endpoint
 * aparte (`/api/appointment-stats/mensajes-pagados`, que consulta al proxy).
 * Mientras esa respuesta no llega, ese número vale 0, y mostrarlo significa
 * dibujar un total y un costo que están mal y que cambian solos un segundo
 * después.
 *
 * El que lo mira no tiene forma de saber que ese 18 era un número a medio
 * cargar: un dato incompleto que se ve igual que un dato bueno es peor que un
 * spinner. Por eso esperan los cuatro juntos, incluido "Conversaciones
 * iniciadas", que ya tiene su valor: si se mostrara solo, la tarjeta quedaría
 * con un número firme al lado de tres cargando y parecería que los otros tres
 * fallaron.
 */

import { Loader2, MessageCircle, Send, TrendingUp } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { CostoAproximado } from "@/components/stats/costo-aproximado"

/** Un valor de la tarjeta: el número, o el spinner mientras no esté. */
function Valor({ cargando, children }: { cargando: boolean; children: React.ReactNode }) {
  if (cargando) {
    // La misma altura que el número, para que la tarjeta no salte al resolverse.
    return (
      <div className="flex h-9 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  return <div className="text-3xl font-bold text-purple-600">{children}</div>
}

export function TarjetaDeInteracciones({
  clienteId,
  mensajesPagados,
  conversacionesIniciadas,
  cargando,
}: {
  clienteId: string
  mensajesPagados: number
  conversacionesIniciadas: number
  /** Todavía no llegó la respuesta de "recordatorios enviados". */
  cargando: boolean
}) {
  return (
    <Card className="border-purple-200 bg-purple-50/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-purple-600" />
          Total de Interacciones
        </CardTitle>
        <CardDescription>
          Sumatoria de recordatorios enviados y conversaciones iniciadas por pacientes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="text-center p-4 bg-white rounded-lg border border-purple-100">
            <TrendingUp className="h-6 w-6 text-purple-500 mx-auto mb-2" />
            <Valor cargando={cargando}>{mensajesPagados + conversacionesIniciadas}</Valor>
            <div className="text-sm text-muted-foreground mt-1">Total de interacciones</div>
          </div>

          <div className="text-center p-4 bg-white rounded-lg border border-purple-100">
            <Send className="h-6 w-6 text-purple-400 mx-auto mb-2" />
            <Valor cargando={cargando}>{mensajesPagados}</Valor>
            <div className="text-sm text-muted-foreground mt-1">Recordatorios enviados</div>
          </div>

          <div className="text-center p-4 bg-white rounded-lg border border-purple-100">
            <MessageCircle className="h-6 w-6 text-purple-400 mx-auto mb-2" />
            <Valor cargando={cargando}>{conversacionesIniciadas}</Valor>
            <div className="text-sm text-muted-foreground mt-1">Conversaciones iniciadas</div>
          </div>

          <CostoAproximado
            clienteId={clienteId}
            interacciones={mensajesPagados + conversacionesIniciadas}
            cargandoInteracciones={cargando}
          />
        </div>
      </CardContent>
    </Card>
  )
}
