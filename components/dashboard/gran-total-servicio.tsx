"use client"

/**
 * El total de las dos tablas de Servicio (30/10/2026).
 *
 * ── Para qué ───────────────────────────────────────────────────────────────
 *
 * Servicio muestra dos tablas —"Clientes Wpp con IA" y "Clientes Wpp sin IA"—
 * y cada una termina en su "Total general". Para saber cuánto es TODO había
 * que sumar las dos a mano, cada vez, en siete columnas. Esto lo hace.
 *
 * ── Por qué muestra las dos filas y no sólo la suma ────────────────────────
 *
 * Porque un número que no se puede verificar en la misma pantalla no se usa
 * para facturar. Mostrando los dos sumandos y el resultado, cualquiera
 * comprueba la cuenta de un vistazo y, si algo no cierra, ve de qué tabla
 * viene. La suma sola obligaría a volver a las dos tablas y restar.
 *
 * ── Qué NO hace ────────────────────────────────────────────────────────────
 *
 * No consulta ni recalcula nada. Los números son los que las tablas ya
 * reportaron de su propia fila de totales (ver `TotalesDeLaTabla`): si el
 * cálculo cambia, cambia en un solo lugar y esto lo sigue. Un componente que
 * volviera a pedir los datos y sumara por su cuenta podría mostrar un gran
 * total que no coincida con las dos filas que están arriba.
 *
 * ── Y si una tabla no cargó ────────────────────────────────────────────────
 *
 * No se suma. Un total con un solo sumando no es "casi el total": es otro
 * número, y presentado en el renglón del total se lee como el bueno. Mientras
 * falte una de las dos, se dice que falta.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { TotalesDeLaTabla } from "./facturacion-table"

const formatoUSDMoney = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
})
const formatoARS = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2,
})

interface Parte {
  etiqueta: string
  totales: TotalesDeLaTabla | null
}

export function GranTotalServicio({
  partes,
  costosFijosUSD,
}: {
  partes: Parte[]
  /**
   * Los costos fijos del mes, con sus impuestos: lo que la tarjeta cobró de
   * servicios que no son Meta (Vercel, OpenAI, Upstash).
   *
   * Se restan del resultado GENERAL y no de ninguna fila: no se pueden
   * atribuir a una clínica —Upstash no escala con los mensajes de una sola— y
   * prorratearlos sería inventar una atribución que no existe.
   *
   * `null` o ausente = todavía no se sabe. Cero = no hay ningún resumen de
   * tarjeta cargado para este mes, y entonces el resultado no los incluye; se
   * dice, en vez de mostrar un resultado que parece neto y no lo es.
   */
  costosFijosUSD?: number | null
}) {
  const faltan = partes.filter((p) => p.totales === null).map((p) => p.etiqueta)

  if (faltan.length > 0) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base">Total de todas las tablas</CardTitle>
          <CardDescription>
            Falta {faltan.length === 1 ? "la tabla de" : "las tablas de"} {faltan.join(" y ")}. El
            total aparece cuando las {partes.length} hayan cargado: sumar una sola daría un número
            que parece el total y no lo es.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const listas = partes.map((p) => ({ etiqueta: p.etiqueta, t: p.totales as TotalesDeLaTabla }))
  const sumar = (f: (t: TotalesDeLaTabla) => number) => listas.reduce((s, { t }) => s + f(t), 0)

  const total = {
    clientes: sumar((t) => t.clientes),
    recordatorios: sumar((t) => t.recordatorios),
    mensajesDeServicio: sumar((t) => t.mensajesDeServicio),
    interacciones: sumar((t) => t.interacciones),
    mensajesConCargo: sumar((t) => t.mensajesConCargo),
    costoUSD: sumar((t) => t.costoUSD),
    costoMetaUSD: sumar((t) => t.costoMetaUSD),
    costoImpuestosUSD: sumar((t) => t.costoImpuestosUSD),
    valorUSD: sumar((t) => t.valorUSD),
    valorARS: sumar((t) => t.valorARS),
    margenUSD: sumar((t) => t.margenUSD),
    margenARS: sumar((t) => t.margenARS),
    filasSinCosto: sumar((t) => t.filasSinCosto),
  }

  // Las columnas opcionales se muestran si ALGUNA tabla las trae. Si una sí y
  // otra no, el aviso de abajo lo dice: la suma de esa columna es sólo de las
  // que la traen, y callarlo sería mostrar un total incompleto como completo.
  const hayDesglose = listas.some(({ t }) => t.hayDesglose)
  const desgloseParcial = hayDesglose && listas.some(({ t }) => !t.hayDesglose)
  const hayCosto = listas.some(({ t }) => t.hayCosto)
  const costoParcial = hayCosto && listas.some(({ t }) => !t.hayCosto)
  // El desglose del costo lo decide el período, que es el mismo para las dos
  // tablas. Se exige que las dos lo tengan igual: si no, se muestra el costo
  // junto, que es el único número comparable entre ellas.
  const costoDesglosado = hayCosto && listas.every(({ t }) => t.costoDesglosado)

  const numero = (n: number) => n.toLocaleString("es-AR")

  const celdas = (t: TotalesDeLaTabla) => (
    <>
      {hayDesglose && (
        <>
          <TableCell className="text-right">{numero(t.recordatorios)}</TableCell>
          <TableCell className="text-right">{numero(t.mensajesDeServicio)}</TableCell>
        </>
      )}
      <TableCell className="text-right">{numero(t.interacciones)}</TableCell>
      {hayCosto && (
        <TableCell className="text-right">
          {formatoUSDMoney.format(costoDesglosado ? t.costoMetaUSD : t.costoUSD)}
        </TableCell>
      )}
      {costoDesglosado && (
        <TableCell className="text-right">{formatoUSDMoney.format(t.costoImpuestosUSD)}</TableCell>
      )}
      <TableCell className="text-right">{formatoUSDMoney.format(t.valorUSD)}</TableCell>
      <TableCell className="text-right">{formatoARS.format(t.valorARS)}</TableCell>
      {hayCosto && (
        <>
          <TableCell className={`text-right ${t.margenUSD < 0 ? "text-destructive" : ""}`}>
            {formatoUSDMoney.format(t.margenUSD)}
          </TableCell>
          <TableCell className={`text-right ${t.margenARS < 0 ? "text-destructive" : ""}`}>
            {formatoARS.format(t.margenARS)}
          </TableCell>
        </>
      )}
    </>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Total de todas las tablas</CardTitle>
        <CardDescription>
          La suma de los totales generales de las {listas.length} tablas de arriba ·{" "}
          {numero(total.clientes)} {total.clientes === 1 ? "clínica" : "clínicas"} en el período
          seleccionado
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Origen</TableHead>
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
              <TableHead className="text-right">Total de Interacciones</TableHead>
              {hayCosto && (
                <TableHead className="text-right font-normal text-muted-foreground">
                  {costoDesglosado ? "Costo Meta" : "Costo"}
                </TableHead>
              )}
              {costoDesglosado && (
                <TableHead className="text-right font-normal text-muted-foreground">
                  Impuestos
                </TableHead>
              )}
              <TableHead className="text-right">Valor Total Dólares</TableHead>
              <TableHead className="text-right">Valor Total Pesos</TableHead>
              {hayCosto && (
                <>
                  <TableHead className="text-right">Resultado USD</TableHead>
                  <TableHead className="text-right">Resultado ARS</TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {listas.map(({ etiqueta, t }) => (
              <TableRow key={etiqueta}>
                <TableCell className="text-muted-foreground">{etiqueta}</TableCell>
                {celdas(t)}
              </TableRow>
            ))}
            <TableRow className="bg-primary/5 font-semibold">
              <TableCell>Total general de todo</TableCell>
              {hayDesglose && (
                <>
                  <TableCell className="text-right">{numero(total.recordatorios)}</TableCell>
                  <TableCell className="text-right">{numero(total.mensajesDeServicio)}</TableCell>
                </>
              )}
              <TableCell className="text-right">{numero(total.interacciones)}</TableCell>
              {hayCosto && (
                <TableCell className="text-right">
                  {formatoUSDMoney.format(costoDesglosado ? total.costoMetaUSD : total.costoUSD)}
                  {total.mensajesConCargo !== total.interacciones && (
                    <span className="block text-[10px] font-normal text-muted-foreground">
                      {numero(total.mensajesConCargo)} con cargo
                    </span>
                  )}
                </TableCell>
              )}
              {costoDesglosado && (
                <TableCell className="text-right">
                  {formatoUSDMoney.format(total.costoImpuestosUSD)}
                  <span className="block text-[10px] font-normal text-muted-foreground">
                    costo total {formatoUSDMoney.format(total.costoUSD)}
                  </span>
                </TableCell>
              )}
              <TableCell className="text-right">{formatoUSDMoney.format(total.valorUSD)}</TableCell>
              <TableCell className="text-right">{formatoARS.format(total.valorARS)}</TableCell>
              {hayCosto && (
                <>
                  <TableCell
                    className={`text-right ${total.margenUSD < 0 ? "text-destructive" : ""}`}
                  >
                    {formatoUSDMoney.format(total.margenUSD)}
                    {total.filasSinCosto > 0 && (
                      <span className="block text-[10px] font-normal text-muted-foreground">
                        sin {numero(total.filasSinCosto)} fila
                        {total.filasSinCosto === 1 ? "" : "s"} sin costo
                      </span>
                    )}
                  </TableCell>
                  <TableCell
                    className={`text-right ${total.margenARS < 0 ? "text-destructive" : ""}`}
                  >
                    {formatoARS.format(total.margenARS)}
                  </TableCell>
                </>
              )}
            </TableRow>
          </TableBody>
        </Table>

        {/* ── El resultado después de los costos fijos ───────────────────
            Los mensajes son el costo variable; Vercel, OpenAI y Upstash son
            fijos y no están en ninguna columna de la tabla, porque no se
            pueden atribuir a un cliente. Sin esta línea, el "Resultado" de
            arriba se lee como el resultado del mes y le falta esta parte.

            El dólar es el mismo con el que se valorizó el mes —sale de dividir
            el total en pesos por el total en dólares— y no la cotización de
            hoy: si no, el resultado en pesos no coincidiría con la fila de
            arriba. */}
        {hayCosto && costosFijosUSD !== null && costosFijosUSD !== undefined && (
          <div className="mt-3 rounded border bg-muted/30 px-3 py-2 text-xs">
            {costosFijosUSD > 0 ? (
              <>
                <p>
                  <span className="font-medium">Resultado después de costos fijos:</span>{" "}
                  <span
                    className={
                      total.margenUSD - costosFijosUSD < 0 ? "font-semibold text-destructive" : "font-semibold"
                    }
                  >
                    {formatoUSDMoney.format(total.margenUSD - costosFijosUSD)}
                  </span>
                  {total.valorUSD > 0 && (
                    <>
                      {" · "}
                      {formatoARS.format(
                        (total.margenUSD - costosFijosUSD) * (total.valorARS / total.valorUSD),
                      )}
                    </>
                  )}
                </p>
                <p className="mt-0.5 text-muted-foreground">
                  {formatoUSDMoney.format(total.margenUSD)} de resultado menos{" "}
                  {formatoUSDMoney.format(costosFijosUSD)} de servicios que no son Meta (Vercel,
                  OpenAI, Upstash, con sus sellos), tomados del resumen de tarjeta de este mes.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">
                El resultado de arriba no incluye costos fijos: todavía no hay un resumen de tarjeta
                cargado para este mes. Se carga abajo, en la conciliación.
              </p>
            )}
          </div>
        )}

        {/* El costo no corre sobre el total: los mensajes de servicio gratuitos
            se facturan y a nosotros no nos cuestan. Es la misma aclaración que
            hace cada tabla, y acá hace más falta todavía — es el único lugar
            donde las dos columnas se ven juntas sin su encabezado explicado. */}
        {hayCosto && (
          <p className="mt-3 text-xs text-muted-foreground">
            El costo corre sólo sobre los mensajes que Meta cobra, así que no cierra con el total
            de interacciones. El resultado es ingresos menos ese costo.
          </p>
        )}

        {(desgloseParcial || costoParcial) && (
          <p className="mt-2 rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-xs text-amber-900">
            {desgloseParcial && "No todas las tablas traen el desglose de recordatorios y mensajes de servicio. "}
            {costoParcial && "No todas las tablas traen el costo. "}
            Esas columnas suman sólo las que sí lo traen.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
