/**
 * De qué está hecho el costo de un mensaje (30/10/2026).
 *
 * ── El problema que resuelve ───────────────────────────────────────────────
 *
 * Había un solo número: `COSTO_POR_MENSAJE_CON_CARGO_USD = 0.0318`. Es
 * correcto, pero no se puede conciliar con nada: el resumen de la tarjeta no
 * trae 0,0318 por ningún lado. Trae el cargo de Meta en dólares, y los
 * impuestos aparte, en pesos, calculados sobre bases distintas.
 *
 * Partido en componentes, cada parte tiene un correlato en el resumen y se
 * puede verificar contra él.
 *
 * ── De dónde salen estos números ───────────────────────────────────────────
 *
 * Del resumen BBVA Mastercard con cierre 01-Oct-26, verificado al centavo:
 *
 *   · 37 cargos `FACEBK *…` por US$ 2.563,72
 *   · la base del IVA RG 4240 son $2.253.124,25 + $1.636.038,99 = $3.889.163,24
 *     y al dólar del resumen (1517,00) eso es US$ 2.563,72 EXACTO: o sea que
 *     ese IVA corre sobre los cargos de Meta y sobre nada más. Los US$ 196,84
 *     de Vercel, OpenAI y Upstash no están alcanzados — por eso `base`.
 *   · sellos: $20.730,55 + $41.884,37 sobre $4.187.769,52 = 0,495 % + 1,000 %,
 *     y ésos sí corren sobre TODO el consumo del período.
 *
 * Y la cuenta cierra con el 0,0318 que ya estaba:
 *
 *   0,026 × (1 + 0,21 + 0,015) = 0,03185
 *
 * ── Lo que queda deliberadamente afuera ────────────────────────────────────
 *
 * La percepción RG 5617 del 30 %. El resumen la debita (`DB.RG 5617 30%`) y la
 * acredita entera un período después (`CR.RG 5617 30% M`): en este resumen,
 * −$435.209,89, que es el 30 % de los US$ 958,19 del resumen anterior al dólar
 * de entonces. Va y viene.
 *
 * Es trámite de la tarjeta y no afecta nuestra administración, así que no entra
 * en ningún número de acá. Lo único que hace el módulo del resumen es dejarla
 * marcada como excluida cuando aparece, para que nadie piense que se perdió una
 * línea al cargar el comprobante.
 *
 * ── Por qué fechado ───────────────────────────────────────────────────────
 *
 * Mismo criterio que lib/facturacion-reglas.ts y lib/servicio-calculo.ts: lo
 * decide el PERÍODO que se mira, no la fecha de hoy. Los meses anteriores a
 * octubre de 2026 se siguen mostrando con el 0,0318 sin desglose: ya se
 * miraron así, y recalcularlos con 0,03185 les cambiaría el costo un 0,16 % sin
 * que haya pasado nada.
 */

import { COSTO_POR_MENSAJE_CON_CARGO_USD } from "./facturacion-reglas"

/** Un impuesto que la tarjeta suma a lo consumido. */
export interface ImpuestoDelCosto {
  id: string
  nombre: string
  /** Cómo figura en el resumen, para poder buscarlo ahí. */
  enElResumen: string
  alicuota: number
  /**
   * Sobre qué corre en el resumen: sólo los cargos de Meta, o todo el consumo
   * del período (Vercel, OpenAI, Upstash y lo que haya).
   *
   * Para el costo POR MENSAJE da igual —las dos bases incluyen el cargo de
   * Meta—. Importa para los costos fijos: los cargos que no son de Meta pagan
   * sellos y NO pagan el IVA RG 4240, y eso está verificado contra el resumen.
   */
  base: "cargos_de_meta" | "consumo_total"
}

export interface ComposicionDelCosto {
  /** Primer período que usa esta composición, "YYYY-MM". */
  desde: string
  nombre: string
  /** Lo que cobra Meta por mensaje, sin impuestos. */
  metaUSD: number
  impuestos: ImpuestoDelCosto[]
}

/**
 * Las composiciones, de la más nueva a la más vieja.
 *
 * Para agregar un cambio: una entrada nueva arriba con su `desde`. No se
 * modifica una existente — eso reescribiría meses ya mirados.
 */
export const COMPOSICIONES: ComposicionDelCosto[] = [
  {
    desde: "2026-10",
    nombre: "Meta + IVA RG 4240 + sellos",
    metaUSD: 0.026,
    impuestos: [
      {
        id: "iva_rg4240",
        nombre: "IVA RG 4240",
        enElResumen: "IVA RG 4240 21%( base )",
        alicuota: 0.21,
        base: "cargos_de_meta",
      },
      {
        id: "sellos",
        nombre: "Impuesto de sellos",
        enElResumen: "IMPUESTO DE SELLOS $ · IMPUESTO DE SELLOS P $",
        alicuota: 0.015,
        base: "consumo_total",
      },
    ],
  },
]

/** El primer período con el costo discriminado. */
export const COSTO_DESGLOSADO_DESDE = COMPOSICIONES[COMPOSICIONES.length - 1].desde

export interface ParteDelCosto {
  id: string
  nombre: string
  alicuota: number
  importeUSD: number
}

export interface CostoPorMensaje {
  periodo: string
  /**
   * Si este período tiene el costo discriminado.
   *
   * Cuando es `false` hay un solo número y no se sabe de qué está hecho: la
   * tabla muestra una sola columna "Costo", igual que antes de este cambio.
   * Fingir un desglose para esos meses sería inventar la parte de impuestos.
   */
  desglosado: boolean
  composicion: string
  /** Lo que cobra Meta. Cuando no hay desglose, es el costo entero. */
  metaUSD: number
  /** Los impuestos sobre ese cargo. 0 cuando no hay desglose. */
  impuestosUSD: number
  /** Meta + impuestos: lo que cuesta de verdad, y lo que se resta del resultado. */
  totalUSD: number
  partes: ParteDelCosto[]
}

/** La composición que rige para un período, o `null` si es anterior a todas. */
export function composicionDelPeriodo(periodo: string): ComposicionDelCosto | null {
  if (!/^\d{4}-\d{2}$/.test(periodo)) return null
  // Las comparaciones son de strings "YYYY-MM", que para este formato ordenan
  // igual que por fecha y no arrastran zonas horarias.
  for (const c of COMPOSICIONES) {
    if (periodo >= c.desde) return c
  }
  return null
}

/**
 * Cuánto cuesta un mensaje con cargo en este período, y de qué está hecho.
 *
 * Es la única fuente: la tabla, los totales y la conciliación lo piden acá.
 * Antes el 0,0318 estaba escrito en cuatro lugares de la tabla.
 */
export function costoPorMensaje(periodo: string): CostoPorMensaje {
  const composicion = composicionDelPeriodo(periodo)

  if (!composicion) {
    return {
      periodo,
      desglosado: false,
      composicion: "Costo único, sin discriminar",
      metaUSD: COSTO_POR_MENSAJE_CON_CARGO_USD,
      impuestosUSD: 0,
      totalUSD: COSTO_POR_MENSAJE_CON_CARGO_USD,
      partes: [],
    }
  }

  const partes: ParteDelCosto[] = composicion.impuestos.map((i) => ({
    id: i.id,
    nombre: i.nombre,
    alicuota: i.alicuota,
    // Todos los impuestos corren sobre el importe del consumo, así que por
    // mensaje la base es siempre el cargo de Meta. `base` dice qué MÁS entra en
    // la base del resumen, que es otra pregunta y la usan los costos fijos.
    importeUSD: composicion.metaUSD * i.alicuota,
  }))

  const impuestosUSD = partes.reduce((s, p) => s + p.importeUSD, 0)

  return {
    periodo,
    desglosado: true,
    composicion: composicion.nombre,
    metaUSD: composicion.metaUSD,
    impuestosUSD,
    totalUSD: composicion.metaUSD + impuestosUSD,
    partes,
  }
}

/**
 * Los impuestos que le corresponden a un cargo que NO es de Meta.
 *
 * Vercel, OpenAI y Upstash pagan sellos y no pagan el IVA RG 4240 — está
 * verificado contra el resumen del 01-Oct-26, donde la base del IVA es
 * exactamente la suma de los cargos de Meta y esos US$ 196,84 quedan afuera.
 *
 * Por eso los costos fijos no se pueden calcular con el mismo recargo que los
 * mensajes: serían un 21 % más caros de lo que son.
 */
export function impuestosDeUnCargoFijo(periodo: string, importeUSD: number): number {
  const composicion = composicionDelPeriodo(periodo)
  if (!composicion) return 0
  return composicion.impuestos
    .filter((i) => i.base === "consumo_total")
    .reduce((s, i) => s + importeUSD * i.alicuota, 0)
}
