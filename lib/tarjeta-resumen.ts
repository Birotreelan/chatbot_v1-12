/**
 * Leer un resumen de tarjeta pegado como texto (30/10/2026).
 *
 * ── Por qué texto pegado y no el PDF ───────────────────────────────────────
 *
 * Porque el texto del resumen es muy regular y alcanza: se probó contra el
 * resumen BBVA con cierre 01-Oct-26 y salieron las 41 líneas de consumo, el
 * total declarado al centavo y el tipo de cambio exacto. Parsear el PDF
 * adentro de la app querría decir una librería más, el archivo guardado en
 * algún lado y un formato que el banco puede cambiar sin avisar. Pegar el
 * texto no tiene ninguna de esas piezas.
 *
 * ── El resumen se verifica a sí mismo ──────────────────────────────────────
 *
 * Esto es lo que hace confiable la carga, y es el motivo por el que el módulo
 * no se limita a sumar lo que encuentra:
 *
 *   1. El resumen DECLARA su total de consumos. Si la suma de las líneas que
 *      encontramos no da ese número, falta o sobra alguna línea.
 *   2. La base del IVA RG 4240 es exactamente los cargos de Meta pasados a
 *      pesos. Dividiéndola por la suma de los cargos `FACEBK` sale el tipo de
 *      cambio del resumen, y tiene que coincidir con el que sale de la base de
 *      la percepción dividida por el total de consumos. Dos caminos
 *      independientes al mismo número.
 *   3. Con ese tipo de cambio, los impuestos en pesos tienen que dar las
 *      alícuotas declaradas en lib/servicio-costos.ts (21 % y 1,5 %).
 *
 * Si alguna falla, el análisis lo dice y la pantalla no deja guardar. Un
 * comprobante cargado a medias es peor que ninguno: la conciliación empezaría a
 * arrastrar una diferencia que nadie va a poder explicar tres meses después.
 *
 * ── La percepción del 30 % no se computa ───────────────────────────────────
 *
 * `DB.RG 5617 30%` va y vuelve: el resumen la debita y la acredita entera en el
 * siguiente (`CR.RG 5617 30% M`). Es trámite de la tarjeta y no afecta nuestra
 * administración, así que no entra en ningún total. Se la reconoce igual, con
 * `computa: false`, por dos motivos: su base es el segundo camino para el tipo
 * de cambio, y porque una línea grande que desaparece sin explicación hace
 * dudar de todo lo demás.
 *
 * ── Qué NO decide este módulo ──────────────────────────────────────────────
 *
 * Si un cargo `FACEBK` es de mensajería o de publicidad. Los descriptores del
 * resumen son opacos —`FACEBK *9WRQ646BJ4` no dice nada— así que acá se
 * clasifican todos como Meta y la pantalla permite corregir línea por línea.
 * Adivinarlo por el importe sería inventar.
 */

import { composicionDelPeriodo } from "./servicio-costos"

const MESES: Record<string, string> = {
  ene: "01", feb: "02", mar: "03", abr: "04", may: "05", jun: "06",
  jul: "07", ago: "08", sep: "09", set: "09", oct: "10", nov: "11", dic: "12",
}

export type CategoriaDeLinea = "meta" | "otro"

export interface LineaDelResumen {
  /** ISO "2026-09-01". */
  fecha: string
  descripcion: string
  cupon?: string
  importeUSD: number
  categoria: CategoriaDeLinea
}

export interface ImpuestoDelResumen {
  /** "iva_rg4240" | "sellos" | "rg5617" | "otro". */
  id: string
  descripcion: string
  importeARS: number
  /** La base, cuando el resumen la escribe entre paréntesis. */
  baseARS?: number
  /** Si entra en nuestros números. `false` para la percepción del 30 %. */
  computa: boolean
}

export interface Verificacion {
  id: string
  descripcion: string
  ok: boolean
  detalle: string
}

export interface ResumenAnalizado {
  /** ISO "2026-10-01". */
  cierre: string | null
  cierreAnterior: string | null
  vencimiento: string | null
  /**
   * El dólar con el que el banco pasó los consumos a pesos para los impuestos.
   * Sale del propio resumen; `null` si no se pudo derivar.
   */
  tipoDeCambio: number | null
  lineas: LineaDelResumen[]
  totalDeclaradoUSD: number | null
  totalDeclaradoARS: number | null
  impuestos: ImpuestoDelResumen[]
  verificaciones: Verificacion[]
  /** Lo que impide guardar. Vacío = se puede guardar. */
  problemas: string[]
}

/** "2.760,56" → 2760.56 */
function aNumero(texto: string): number {
  const limpio = String(texto).trim().replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "")
  const n = Number(limpio)
  return Number.isFinite(n) ? n : NaN
}

/** "01-Oct-26" → "2026-10-01". Devuelve null si no se entiende. */
export function aFechaISO(texto: string): string | null {
  const m = /^(\d{1,2})-([A-Za-zÁÉÍÓÚáéíóú]{3})-(\d{2,4})$/.exec(String(texto).trim())
  if (!m) return null
  const [, dia, mesTexto, anio] = m
  const mes = MESES[mesTexto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")]
  if (!mes) return null
  const anioCompleto = anio.length === 4 ? anio : `20${anio}`
  return `${anioCompleto}-${mes}-${dia.padStart(2, "0")}`
}

/**
 * Las descripciones que NO son consumos: pagos, ajustes, impuestos, saldos.
 *
 * Hace falta porque el resumen repite los mismos conceptos en dos lugares —el
 * recuadro de arriba y el detalle— y porque la sección de pagos tiene la misma
 * forma que la de consumos.
 */
const NO_ES_CONSUMO =
  /^(SU PAGO|CR\.RG|DB\.RG|IMPUESTO DE SELLOS|IVA RG|SALDO|TOTAL CONSUMOS|INTERES|COMISION|COM CUENTA|PAGO MINIMO)/i

/** Un consumo en moneda extranjera dice su moneda en la descripción. */
const MONEDA_EN_LA_DESCRIPCION = /\b(USD|U\$S|AUD|EUR|GBP|BRL|CLP|UYU|MXN|CAD|CHF|JPY)\b/i

const UNA_FECHA = /\d{1,2}-[A-Za-z]{3}-\d{2,4}/g

/**
 * ¿La descripción es de un comercio, o son números que quedaron alineados?
 *
 * Hace falta por el recuadro del encabezado: la fila de valores de "CIERRE
 * ACTUAL" es `01-Oct-26 09-Oct-26 2.135.624,33 2.760,56 2.350.123,00`, que
 * empieza con una fecha y termina con un importe — exactamente la forma de un
 * consumo. Sin este filtro entraba como un consumo en pesos de $2.350.123,00,
 * y la verificación del total en pesos fallaba por eso.
 *
 * El criterio: sacando las fechas, tiene que quedar texto. Un comercio siempre
 * tiene nombre; una fila de números, no.
 */
function pareceUnComercio(descripcion: string): boolean {
  const sinFechas = descripcion.replace(UNA_FECHA, " ")
  return /[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}/.test(sinFechas)
}

/**
 * El trozo donde están los consumos, si el texto trae las dos marcas.
 *
 * Es la defensa estructural, y la de arriba es la defensa por línea. Se quieren
 * las dos: con el PDF entero esto acota la búsqueda a la sección correcta, y si
 * alguien pega sólo un pedazo —sin el título de la sección— el filtro por línea
 * sigue trabajando.
 */
function seccionDeConsumos(texto: string): string {
  const lineas = texto.split(/\r?\n/)
  const desde = lineas.findIndex((l) => /^\s*Consumos\b/i.test(l))
  if (desde < 0) return texto
  const hasta = lineas.findIndex((l, i) => i > desde && /^\s*TOTAL CONSUMOS/i.test(l))
  if (hasta < 0) return texto
  return lineas.slice(desde, hasta).join("\n")
}

/**
 * Qué impuesto es esta línea.
 *
 * El id importa: con él la conciliación compara contra las alícuotas declaradas
 * en servicio-costos.ts, que es el único lugar donde viven.
 */
function clasificarImpuesto(descripcion: string): { id: string; computa: boolean } {
  const d = descripcion.toUpperCase()
  if (d.includes("IVA RG 4240")) return { id: "iva_rg4240", computa: true }
  if (d.includes("IMPUESTO DE SELLOS")) return { id: "sellos", computa: true }
  // Va y vuelve: no se computa. Ver la nota de arriba.
  if (d.includes("RG 5617")) return { id: "rg5617", computa: false }
  return { id: "otro", computa: true }
}

function fechaDeEncabezado(texto: string, etiqueta: RegExp): string | null {
  const lineas = texto.split(/\r?\n/)
  for (let i = 0; i < lineas.length; i++) {
    if (!etiqueta.test(lineas[i])) continue
    // La fecha puede estar en la misma línea o en la de abajo: el recuadro del
    // resumen pone los títulos en una fila y los valores en la siguiente.
    for (const candidata of [lineas[i], lineas[i + 1] ?? ""]) {
      const fechas = candidata.match(/\d{1,2}-[A-Za-z]{3}-\d{2,4}/g)
      if (!fechas) continue
      // En la línea de títulos no hay fechas, así que la primera que aparezca
      // en la de valores es la de la columna que se está buscando… salvo que
      // haya varias columnas. Por eso el llamador pasa la posición.
      const iso = aFechaISO(fechas[0])
      if (iso) return iso
    }
  }
  return null
}

/**
 * Las fechas del recuadro "CIERRE ACTUAL / VENCIMIENTO ACTUAL" y del de
 * "Otros períodos", que vienen varias en la misma línea.
 */
function fechasDeLaFila(texto: string, etiqueta: RegExp): string[] {
  const lineas = texto.split(/\r?\n/)
  for (let i = 0; i < lineas.length; i++) {
    if (!etiqueta.test(lineas[i])) continue
    for (const candidata of [lineas[i], lineas[i + 1] ?? "", lineas[i + 2] ?? ""]) {
      const fechas = candidata.match(/\d{1,2}-[A-Za-z]{3}-\d{2,4}/g)
      if (fechas && fechas.length > 0) {
        return fechas.map((f) => aFechaISO(f)).filter((f): f is string => Boolean(f))
      }
    }
  }
  return []
}

export function analizarResumen(textoCrudo: string): ResumenAnalizado {
  const texto = String(textoCrudo || "")
  const problemas: string[] = []
  const verificaciones: Verificacion[] = []

  // ── Fechas del período ───────────────────────────────────────────────────
  const delCierre = fechasDeLaFila(texto, /CIERRE\s+ACTUAL/i)
  const cierre = delCierre[0] ?? null
  const vencimiento = delCierre[1] ?? fechaDeEncabezado(texto, /VENCIMIENTO\s+ACTUAL/i)
  // "Otros períodos" trae cuatro: cierre anterior, vencimiento anterior,
  // próximo cierre, próximo vencimiento. El anterior es el primero.
  const otros = fechasDeLaFila(texto, /CIERRE\s+ANTERIOR/i)
  const cierreAnterior = otros[0] ?? null

  if (!cierre) problemas.push("No encontré la fecha de CIERRE ACTUAL.")

  // ── Consumos ─────────────────────────────────────────────────────────────
  const lineas: LineaDelResumen[] = []
  const cuponesVistos = new Set<string>()
  const vistasSinCupon = new Set<string>()
  let sumaARSDeConsumos = 0

  for (const cruda of seccionDeConsumos(texto).split(/\r?\n/)) {
    const linea = cruda.replace(/\s+/g, " ").trim()
    if (!linea) continue

    // Fecha al principio, importe al final. El cupón, si está, son 6 dígitos
    // antes del importe.
    const m = /^(\d{1,2}-[A-Za-z]{3}-\d{2,4})\s+(.+?)(?:\s+(\d{6}))?\s+(-?[\d.]+,\d{2})$/.exec(linea)
    if (!m) continue

    const [, fechaCruda, descripcionCruda, cupon, importeCrudo] = m
    const descripcion = descripcionCruda.trim()
    if (NO_ES_CONSUMO.test(descripcion)) continue
    if (!pareceUnComercio(descripcion)) continue

    const fecha = aFechaISO(fechaCruda)
    if (!fecha) continue

    const importe = aNumero(importeCrudo)
    if (!Number.isFinite(importe)) continue

    // Un cupón no se repite. Sin cupón, la terna fecha+descripción+importe hace
    // de identidad: el texto del PDF puede traer la misma línea dos veces si se
    // pegó dos veces una página.
    if (cupon) {
      if (cuponesVistos.has(cupon)) continue
      cuponesVistos.add(cupon)
    } else {
      const huella = `${fecha}|${descripcion}|${importe}`
      if (vistasSinCupon.has(huella)) continue
      vistasSinCupon.add(huella)
    }

    // La moneda la dice la descripción. Un consumo en pesos no la menciona, y
    // ésos no son costo nuestro en dólares: se cuentan aparte para que la
    // verificación contra el total declarado pueda cerrar.
    if (!MONEDA_EN_LA_DESCRIPCION.test(descripcion)) {
      sumaARSDeConsumos += importe
      continue
    }

    lineas.push({
      fecha,
      descripcion,
      cupon,
      importeUSD: importe,
      // Todo lo de Meta llega como FACEBK. El resto son servicios de
      // infraestructura, que son costo fijo y no costo por mensaje.
      categoria: /FACEBK|FACEBOOK|\bMETA\b/i.test(descripcion) ? "meta" : "otro",
    })
  }

  // ── Totales declarados por el propio resumen ─────────────────────────────
  let totalDeclaradoARS: number | null = null
  let totalDeclaradoUSD: number | null = null
  for (const cruda of texto.split(/\r?\n/)) {
    const linea = cruda.replace(/\s+/g, " ").trim()
    if (!/^TOTAL CONSUMOS/i.test(linea)) continue
    const numeros = linea.match(/-?[\d.]+,\d{2}/g)
    if (!numeros || numeros.length === 0) continue
    // Dos columnas: pesos y dólares. Con una sola, es la de dólares sólo si no
    // hay consumos en pesos; no se adivina — se toma como dólares y la
    // verificación del total dirá si cerró.
    if (numeros.length >= 2) {
      totalDeclaradoARS = aNumero(numeros[numeros.length - 2])
      totalDeclaradoUSD = aNumero(numeros[numeros.length - 1])
    } else {
      totalDeclaradoUSD = aNumero(numeros[0])
    }
    break
  }

  // ── Impuestos ────────────────────────────────────────────────────────────
  const impuestos: ImpuestoDelResumen[] = []
  const impuestosVistos = new Set<string>()
  for (const cruda of texto.split(/\r?\n/)) {
    const linea = cruda.replace(/\s+/g, " ").trim()
    // Se exige la fecha adelante justamente para no contar dos veces: estos
    // mismos conceptos aparecen sin fecha en el recuadro de arriba.
    const m = /^(\d{1,2}-[A-Za-z]{3}-\d{2,4})\s+(.+?)\s+(-?[\d.]+,\d{2})$/.exec(linea)
    if (!m) continue
    const [, , descripcionCruda, importeCrudo] = m
    const descripcion = descripcionCruda.trim()
    if (!/^(IMPUESTO DE SELLOS|IVA RG|DB\.RG|CR\.RG)/i.test(descripcion)) continue

    const huella = `${descripcion}|${importeCrudo}`
    if (impuestosVistos.has(huella)) continue
    impuestosVistos.add(huella)

    const base = /\(\s*([\d.]+,\d{2})\s*\)/.exec(descripcion)
    const { id, computa } = clasificarImpuesto(descripcion)
    impuestos.push({
      id,
      descripcion,
      importeARS: aNumero(importeCrudo),
      baseARS: base ? aNumero(base[1]) : undefined,
      computa,
    })
  }

  // ── Las sumas que importan ───────────────────────────────────────────────
  const metaUSD = lineas.filter((l) => l.categoria === "meta").reduce((s, l) => s + l.importeUSD, 0)
  const otrosUSD = lineas.filter((l) => l.categoria === "otro").reduce((s, l) => s + l.importeUSD, 0)
  const totalUSD = metaUSD + otrosUSD

  // ── Verificación 1 · la suma de las líneas contra el total declarado ─────
  if (totalDeclaradoUSD !== null) {
    const diferencia = Math.abs(totalUSD - totalDeclaradoUSD)
    const ok = diferencia < 0.02
    verificaciones.push({
      id: "total_consumos",
      descripcion: "La suma de las líneas da el TOTAL CONSUMOS del resumen",
      ok,
      detalle: ok
        ? `${lineas.length} líneas suman US$ ${totalUSD.toFixed(2)}`
        : `las líneas suman US$ ${totalUSD.toFixed(2)} y el resumen declara US$ ${totalDeclaradoUSD.toFixed(2)} (diferencia US$ ${diferencia.toFixed(2)})`,
    })
    if (!ok) {
      problemas.push(
        `Falta o sobra alguna línea: encontré US$ ${totalUSD.toFixed(2)} y el resumen declara US$ ${totalDeclaradoUSD.toFixed(2)}.`,
      )
    }
  } else {
    verificaciones.push({
      id: "total_consumos",
      descripcion: "La suma de las líneas da el TOTAL CONSUMOS del resumen",
      ok: false,
      detalle: "no encontré la línea TOTAL CONSUMOS, así que no hay contra qué verificar",
    })
    problemas.push("No encontré la línea TOTAL CONSUMOS: sin ella no puedo verificar la carga.")
  }

  if (totalDeclaradoARS !== null && Math.abs(sumaARSDeConsumos - totalDeclaradoARS) >= 0.02) {
    problemas.push(
      `Hay consumos en pesos que no pude leer: encontré $ ${sumaARSDeConsumos.toFixed(2)} y el resumen declara $ ${totalDeclaradoARS.toFixed(2)}.`,
    )
  }

  // ── Verificación 2 · el tipo de cambio, por dos caminos ──────────────────
  const baseIVA = impuestos
    .filter((i) => i.id === "iva_rg4240" && i.baseARS)
    .reduce((s, i) => s + (i.baseARS as number), 0)
  const basePercepcion = impuestos.find((i) => i.id === "rg5617" && i.baseARS)?.baseARS ?? 0

  const porElIVA = baseIVA > 0 && metaUSD > 0 ? baseIVA / metaUSD : null
  const porLaPercepcion = basePercepcion > 0 && totalUSD > 0 ? basePercepcion / totalUSD : null
  const tipoDeCambio = porElIVA ?? porLaPercepcion ?? null

  if (porElIVA !== null && porLaPercepcion !== null) {
    const ok = Math.abs(porElIVA - porLaPercepcion) / porElIVA < 0.005
    verificaciones.push({
      id: "tipo_de_cambio",
      descripcion: "El tipo de cambio sale igual por la base del IVA y por la de la percepción",
      ok,
      detalle: ok
        ? `$ ${porElIVA.toFixed(4)} por dólar, por los dos caminos`
        : `por el IVA da $ ${porElIVA.toFixed(4)} y por la percepción $ ${porLaPercepcion.toFixed(4)}: alguna línea de Meta quedó mal clasificada`,
    })
    if (!ok) {
      problemas.push(
        "Los dos caminos al tipo de cambio no coinciden. Suele ser una línea que no es de Meta marcada como Meta, o al revés.",
      )
    }
  } else if (tipoDeCambio !== null) {
    verificaciones.push({
      id: "tipo_de_cambio",
      descripcion: "El tipo de cambio sale del propio resumen",
      ok: true,
      detalle: `$ ${tipoDeCambio.toFixed(4)} por dólar, por un solo camino (falta una de las dos bases para cruzarlo)`,
    })
  } else {
    verificaciones.push({
      id: "tipo_de_cambio",
      descripcion: "El tipo de cambio sale del propio resumen",
      ok: false,
      detalle: "no encontré ninguna base entre paréntesis de la cual derivarlo",
    })
    problemas.push("No pude derivar el tipo de cambio: falta la base del IVA RG 4240 o de la percepción.")
  }

  // ── Verificación 3 · los impuestos dan las alícuotas declaradas ──────────
  const periodo = cierre ? cierre.slice(0, 7) : ""
  const composicion = composicionDelPeriodo(periodo)
  if (composicion && tipoDeCambio) {
    for (const esperado of composicion.impuestos) {
      const cobrado = impuestos
        .filter((i) => i.id === esperado.id)
        .reduce((s, i) => s + i.importeARS, 0)
      if (cobrado === 0) {
        verificaciones.push({
          id: `alicuota_${esperado.id}`,
          descripcion: `${esperado.nombre} al ${(esperado.alicuota * 100).toFixed(1)} %`,
          ok: false,
          detalle: "no aparece en el resumen",
        })
        continue
      }
      const baseUSD = esperado.base === "cargos_de_meta" ? metaUSD : totalUSD
      const real = cobrado / tipoDeCambio / baseUSD
      // 2 % de tolerancia relativa: los sellos del resumen dan 1,495 % contra el
      // 1,5 % declarado, porque el banco redondea cada línea por separado.
      const ok = Math.abs(real - esperado.alicuota) / esperado.alicuota < 0.02
      verificaciones.push({
        id: `alicuota_${esperado.id}`,
        descripcion: `${esperado.nombre} al ${(esperado.alicuota * 100).toFixed(1)} %`,
        ok,
        detalle: `el resumen cobró $ ${cobrado.toFixed(2)}, que es el ${(real * 100).toFixed(3)} % de ${
          esperado.base === "cargos_de_meta" ? "los cargos de Meta" : "todo el consumo"
        }`,
      })
      // No es un problema que impida guardar: una alícuota que cambió es un
      // dato a cargar en servicio-costos.ts, no un error de carga. Pero tiene
      // que verse.
    }
  }

  return {
    cierre,
    cierreAnterior,
    vencimiento,
    tipoDeCambio,
    lineas,
    totalDeclaradoUSD,
    totalDeclaradoARS,
    impuestos,
    verificaciones,
    problemas,
  }
}

/**
 * Los números del resumen, ya sumados, en dólares.
 *
 * Los impuestos del resumen están en pesos y acá se pasan a dólares con el tipo
 * de cambio del propio resumen, no con el nuestro: es el dólar al que el banco
 * los calculó, y usar otro daría un número que no está en ningún comprobante.
 */
export interface TotalesDelResumen {
  cargosDeMetaUSD: number
  cargosFijosUSD: number
  consumoTotalUSD: number
  impuestosARS: number
  impuestosUSD: number
  /** Lo excluido a propósito: la percepción que la tarjeta devuelve. */
  excluidoARS: number
  tipoDeCambio: number | null
  /** Cargos + impuestos computados, en dólares. */
  totalUSD: number
}

export function totalesDelResumen(r: {
  lineas: LineaDelResumen[]
  impuestos: ImpuestoDelResumen[]
  tipoDeCambio: number | null
}): TotalesDelResumen {
  const cargosDeMetaUSD = r.lineas
    .filter((l) => l.categoria === "meta")
    .reduce((s, l) => s + l.importeUSD, 0)
  const cargosFijosUSD = r.lineas
    .filter((l) => l.categoria === "otro")
    .reduce((s, l) => s + l.importeUSD, 0)
  const impuestosARS = r.impuestos.filter((i) => i.computa).reduce((s, i) => s + i.importeARS, 0)
  const excluidoARS = r.impuestos.filter((i) => !i.computa).reduce((s, i) => s + i.importeARS, 0)
  const impuestosUSD = r.tipoDeCambio ? impuestosARS / r.tipoDeCambio : 0

  return {
    cargosDeMetaUSD,
    cargosFijosUSD,
    consumoTotalUSD: cargosDeMetaUSD + cargosFijosUSD,
    impuestosARS,
    impuestosUSD,
    excluidoARS,
    tipoDeCambio: r.tipoDeCambio,
    totalUSD: cargosDeMetaUSD + cargosFijosUSD + impuestosUSD,
  }
}
