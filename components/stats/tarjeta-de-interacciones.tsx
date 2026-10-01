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
 * Todos los valores dependen del consumo, que llega de un endpoint aparte
 * (`/api/appointment-stats/mensajes-pagados`, que consulta al proxy). Mientras
 * esa respuesta no llega, ese número vale 0, y mostrarlo significa dibujar un
 * total y un costo que están mal y que cambian solos un segundo después.
 *
 * El que lo mira no tiene forma de saber que ese 18 era un número a medio
 * cargar: un dato incompleto que se ve igual que un dato bueno es peor que un
 * spinner. Por eso esperan todos juntos, incluido "Conversaciones iniciadas",
 * que ya tiene su valor: si se mostrara solo, la tarjeta quedaría con un
 * número firme al lado de varios cargando y parecería que los otros fallaron.
 *
 * ── Mensajes de servicio ───────────────────────────────────────────────────
 *
 * El recuadro de servicio existe para explicar una diferencia que si no sería
 * inexplicable: Facturación cobra plantillas + mensajes de servicio PAGOS,
 * mientras que acá el total de interacciones son plantillas + conversaciones
 * iniciadas. Sin el desglose a la vista, la clínica compara los dos paneles,
 * ve dos números distintos del mismo mes y llama. Con el desglose, la
 * diferencia se reconstruye sola.
 */

import { Loader2, MessageCircle, MessagesSquare, Send, TrendingUp } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { CostoAproximado } from "@/components/stats/costo-aproximado"

export interface MensajesDeServicio {
  total: number
  gratis: number
  pagados: number
}

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

function Recuadro({
  icono: Icono,
  etiqueta,
  detalle,
  cargando,
  children,
}: {
  icono: typeof TrendingUp
  etiqueta: string
  detalle?: React.ReactNode
  cargando: boolean
  children: React.ReactNode
}) {
  return (
    <div className="text-center p-4 bg-white rounded-lg border border-purple-100">
      <Icono className="h-6 w-6 text-purple-400 mx-auto mb-2" />
      <Valor cargando={cargando}>{children}</Valor>
      <div className="text-sm text-muted-foreground mt-1">{etiqueta}</div>
      {!cargando && detalle && <p className="mt-1 text-xs text-muted-foreground">{detalle}</p>}
    </div>
  )
}

export function TarjetaDeInteracciones({
  clienteId,
  recordatoriosEnviados,
  conversacionesIniciadas,
  servicio,
  cargando,
}: {
  clienteId: string
  /** Plantillas despachadas en el período. */
  recordatoriosEnviados: number
  conversacionesIniciadas: number
  /** `null` mientras no llegó, o si el proxy no manda el desglose. */
  servicio: MensajesDeServicio | null
  /** Todavía no llegó la respuesta del consumo. */
  cargando: boolean
}) {
  const interacciones = recordatoriosEnviados + conversacionesIniciadas

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
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <Recuadro icono={TrendingUp} etiqueta="Total de interacciones" cargando={cargando}>
            {interacciones}
          </Recuadro>

          <Recuadro icono={Send} etiqueta="Recordatorios enviados" cargando={cargando}>
            {recordatoriosEnviados}
          </Recuadro>

          <Recuadro icono={MessageCircle} etiqueta="Conversaciones iniciadas" cargando={cargando}>
            {conversacionesIniciadas}
          </Recuadro>

          {/* Sólo si el proxy manda el desglose. Un recuadro con tres ceros
              sería peor que su ausencia: se leería como "no hubo mensajes de
              servicio" cuando en realidad no sabemos. */}
          {(cargando || servicio) && (
            <Recuadro
              icono={MessagesSquare}
              etiqueta="Mensajes de servicio"
              cargando={cargando}
              detalle={
                servicio ? (
                  <>
                    {servicio.gratis} sin cargo · {servicio.pagados} con cargo
                  </>
                ) : undefined
              }
            >
              {servicio?.total ?? 0}
            </Recuadro>
          )}

          <CostoAproximado
            clienteId={clienteId}
            interacciones={interacciones}
            cargandoInteracciones={cargando}
          />
        </div>
      </CardContent>
    </Card>
  )
}
