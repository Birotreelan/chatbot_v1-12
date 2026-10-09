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

import { Loader2, MessagesSquare, Send } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { CostoAproximado } from "@/components/stats/costo-aproximado"

export interface MensajesDeServicio {
  total: number
  gratis: number
  pagados: number
}

/** Miles con punto: 16742 se lee mal, 16.742 no. */
const num = (n: number) => n.toLocaleString("es-AR")

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
  cargando,
  children,
}: {
  icono: typeof Send
  etiqueta: string
  cargando: boolean
  children: React.ReactNode
}) {
  return (
    <div className="text-center p-4 bg-white rounded-lg border border-purple-100">
      <Icono className="h-6 w-6 text-purple-400 mx-auto mb-2" />
      <Valor cargando={cargando}>{children}</Valor>
      <div className="text-sm text-muted-foreground mt-1">{etiqueta}</div>
    </div>
  )
}

export function TarjetaDeInteracciones({
  clienteId,
  recordatoriosEnviados,
  servicio,
  cargando,
}: {
  clienteId: string
  /** Plantillas despachadas en el período. */
  recordatoriosEnviados: number
  /** `null` mientras no llegó, o si el proxy no manda el desglose. */
  servicio: MensajesDeServicio | null
  /** Todavía no llegó la respuesta del consumo. */
  cargando: boolean
}) {

  // ── Qué se cobra (9/10/2026) ────────────────────────────────────────────
  //
  //     recordatorios enviados + mensajes de servicio
  //
  // Todo, sin distinciones. Los mensajes de servicio entran completos: que Meta
  // no nos cobre los primeros 1.000 de cada cliente es un dato de NUESTRA
  // relación con Meta, no de la relación con la clínica.
  //
  // Lo único que queda afuera son las conversaciones iniciadas por el paciente,
  // que no son mensajes enviados y nunca se facturaron bajo esta regla.
  //
  // Es el mismo total que muestra el panel de Facturación para el período, con
  // el mismo precio por unidad. Los dos números tienen que coincidir: la
  // clínica los compara, y ésa es la única verificación externa que tenemos de
  // que el panel no miente.
  const unidadesFacturables = recordatoriosEnviados + (servicio?.total ?? 0)

  return (
    <Card className="border-purple-200 bg-purple-50/30">
      <CardHeader>
        {/* El título y la bajada siguen al contenido (2/10/2026). Al quedar
            sólo lo que se envía y lo que cuesta, "Total de Interacciones" pasó
            a nombrar un número que ya no está en la tarjeta, y la bajada
            describía dos cifras de las cuales una se fue y la otra nunca
            estuvo. Un encabezado que promete algo que no se ve manda a buscar
            un dato inexistente. */}
        <CardTitle className="flex items-center gap-2">
          <Send className="h-5 w-5 text-purple-600" />
          Consumo de WhatsApp
        </CardTitle>
        <CardDescription>
          Mensajes enviados en el período y su costo estimado.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Recuadro icono={Send} etiqueta="Recordatorios enviados" cargando={cargando}>
            {num(recordatoriosEnviados)}
          </Recuadro>

          {/* Sólo si el proxy manda el desglose. Un recuadro con tres ceros
              sería peor que su ausencia: se leería como "no hubo mensajes de
              servicio" cuando en realidad no sabemos.

              Sin el detalle "X sin cargo · Y con cargo" (9/10/2026): describía
              la franja gratuita de Meta, que es un dato NUESTRO. A la clínica
              se le cobran todos los mensajes de servicio por igual, así que
              tenerlo a la vista invitaba a la pregunta razonable de por qué se
              le factura algo rotulado "sin cargo". */}
          {(cargando || servicio) && (
            <Recuadro icono={MessagesSquare} etiqueta="Mensajes de servicio" cargando={cargando}>
              {num(servicio?.total ?? 0)}
            </Recuadro>
          )}

          <CostoAproximado
            clienteId={clienteId}
            unidades={unidadesFacturables}
            recordatorios={recordatoriosEnviados}
            mensajesDeServicio={servicio?.total ?? 0}
            cargandoInteracciones={cargando}
          />
        </div>
      </CardContent>
    </Card>
  )
}
