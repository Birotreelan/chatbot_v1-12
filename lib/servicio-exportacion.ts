/**
 * El Excel que se le manda a la empresa que nos contrata (2/11/2026).
 *
 * ── Qué va y qué NO va ─────────────────────────────────────────────────────
 *
 * Va el detalle por clínica de las dos tablas de Servicio —con IA y sin IA— con
 * los nueve campos que se acordaron, y el dólar venta arriba para que el total
 * en pesos se pueda recalcular sin preguntar nada.
 *
 * NO va nada de contabilidad interna. Eso no es una omisión por prolijidad: es
 * el punto del archivo. Quedan afuera
 *
 *   · la Observación de cada cliente, que son notas nuestras;
 *   · el Costo Meta y sus Impuestos: es lo que nos cuesta a nosotros prestar
 *     el servicio, no algo que se le facture a nadie. Mostrárselo al que lo
 *     paga sería mostrarle nuestro margen renglón por renglón;
 *   · "Ingresos − costos" en dólares y en pesos, que es nuestro resultado;
 *   · la conciliación con la tarjeta, los costos fijos y todo el resumen.
 *
 * Lo que queda es exactamente lo que se factura: cuántos mensajes se enviaron,
 * a cuánto la unidad y cuánto da.
 *
 * Por eso la exportación tiene su propio módulo y no es "la tabla pasada a
 * Excel": la tabla muestra más de lo que se manda, y si el archivo saliera de
 * recorrer sus columnas, cualquier columna que se agregue mañana se estaría
 * enviando sin que nadie lo decida. Acá la lista de campos está escrita, y
 * agregar uno es una decisión explícita.
 *
 * ── Los números son los de la pantalla ─────────────────────────────────────
 *
 * Las filas las manda el panel, ya calculadas: no se recalculan acá. Es el
 * mismo criterio que el gran total y la conciliación — el archivo que se manda
 * tiene que decir exactamente lo que la persona vio y aprobó antes de
 * mandarlo. Un segundo cálculo del lado del servidor sería una segunda
 * respuesta a la misma pregunta.
 */

import { construirXLSX, type Celda } from "./excel-minimo"

/** Una clínica, con los campos que se mandan. */
export interface FilaExportable {
  cliente: string
  /** `null` cuando el período no trae el desglose (regla anterior a 10/2026). */
  recordatorios: number | null
  mensajesDeServicio: number | null
  interacciones: number
  valorUnitarioUSD: number
  valorTotalUSD: number
  /** `null` si no había cotización. */
  valorTotalARS: number | null
}

export interface GrupoExportable {
  titulo: string
  filas: FilaExportable[]
}

export interface PedidoDeExportacion {
  /** "2026-10" */
  mes: string
  dolarVenta: number | null
  grupos: GrupoExportable[]
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

export function mesLegible(periodo: string): string {
  const [anio, mes] = String(periodo).split("-")
  return `${MESES[Number(mes) - 1] ?? mes} ${anio}`
}

/**
 * Los títulos de las columnas.
 *
 * Son una constante y no algo que se derive de la tabla: agregar una columna
 * al archivo que se manda afuera tiene que ser una línea que alguien escribe
 * acá, no una consecuencia de haber tocado la pantalla.
 */
const ENCABEZADOS = [
  "Cliente",
  "Recordatorios enviados",
  "Mensajes de servicio",
  "Total de Interacciones",
  "Valor por unidad (USD)",
  "Valor Total Dólares",
  "Valor Total Pesos",
]

const ANCHOS = [34, 14, 14, 14, 16, 16, 18]

/** El nombre del archivo: "servicio-2026-10.xlsx". */
export function nombreDelArchivo(mes: string): string {
  return `servicio-${mes}.xlsx`
}

export function construirPlanillaDeServicio(pedido: PedidoDeExportacion): Buffer {
  const filas: Celda[][] = []

  // ── Encabezado del documento ───────────────────────────────────────────
  //
  // El período y el dólar arriba, antes de cualquier número: sin ellos el
  // archivo no se puede interpretar, y un adjunto que hay que preguntar cómo
  // leer es un adjunto que vuelve.
  filas.push([{ v: "Detalle de servicio", f: "textoFuerte" }])
  filas.push([{ v: "Período", f: "texto" }, { v: mesLegible(pedido.mes), f: "texto" }])
  filas.push([
    { v: "Dólar venta", f: "texto" },
    pedido.dolarVenta !== null
      ? { v: pedido.dolarVenta, f: "ars" }
      : { v: "sin cotización", f: "texto" },
  ])
  filas.push([
    { v: "Valor Total Pesos", f: "texto" },
    { v: "= Valor Total Dólares × Dólar venta", f: "texto" },
  ])
  filas.push([])

  let totalInteracciones = 0
  let totalUSD = 0
  let totalARS = 0
  let hayARS = false

  for (const grupo of pedido.grupos) {
    filas.push([{ v: grupo.titulo, f: "textoFuerte" }])
    filas.push(ENCABEZADOS.map((v) => ({ v, f: "encabezado" as const })))

    let gInteracciones = 0
    let gRecordatorios = 0
    let gServicio = 0
    let gUSD = 0
    let gARS = 0

    for (const f of grupo.filas) {
      filas.push([
        { v: f.cliente, f: "texto" },
        { v: f.recordatorios, f: "entero" },
        { v: f.mensajesDeServicio, f: "entero" },
        { v: f.interacciones, f: "entero" },
        { v: f.valorUnitarioUSD, f: "usdPrecio" },
        { v: f.valorTotalUSD, f: "usd" },
        { v: f.valorTotalARS, f: "ars" },
      ])
      gInteracciones += f.interacciones
      gRecordatorios += f.recordatorios ?? 0
      gServicio += f.mensajesDeServicio ?? 0
      gUSD += f.valorTotalUSD
      if (f.valorTotalARS !== null) {
        gARS += f.valorTotalARS
        hayARS = true
      }
    }

    // El total de cada grupo. "Valor por unidad" va vacío a propósito: es un
    // precio por cliente y sumarlo no significaría nada.
    filas.push([
      { v: "Total", f: "textoFuerte" },
      { v: gRecordatorios, f: "enteroFuerte" },
      { v: gServicio, f: "enteroFuerte" },
      { v: gInteracciones, f: "enteroFuerte" },
      { v: null, f: "texto" },
      { v: gUSD, f: "usdFuerte" },
      { v: gARS, f: "arsFuerte" },
    ])
    filas.push([])

    totalInteracciones += gInteracciones
    totalUSD += gUSD
    totalARS += gARS
  }

  // ── El total de todo ───────────────────────────────────────────────────
  //
  // Sólo si hay más de un grupo: con uno solo repetiría la fila de arriba, y
  // un total que repite otro total hace dudar de los dos.
  if (pedido.grupos.length > 1) {
    filas.push([
      { v: "Total general", f: "textoFuerte" },
      { v: null },
      { v: null },
      { v: totalInteracciones, f: "enteroFuerte" },
      { v: null },
      { v: totalUSD, f: "usdFuerte" },
      { v: hayARS ? totalARS : null, f: "arsFuerte" },
    ])
  }

  return construirXLSX({
    nombre: `Servicio ${pedido.mes}`,
    filas,
    anchos: ANCHOS,
  })
}
