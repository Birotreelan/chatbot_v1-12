/**
 * Leer el PDF del resumen con un modelo, en vez de pegarlo como texto
 * (2/11/2026).
 *
 * ── Por qué hizo falta ─────────────────────────────────────────────────────
 *
 * El parser de texto funciona —se probó contra los resúmenes de octubre y de
 * noviembre y sacó las 41 y las 36 líneas exactas— pero sólo con el texto
 * ALINEADO, el que produce `pdftotext -layout`. Cuando una persona abre el PDF,
 * selecciona todo y pega, el visor entrega las columnas una abajo de la otra:
 * primero todas las fechas, después todas las descripciones, después todos los
 * importes. Las filas dejan de existir, y ninguna expresión regular puede
 * reconstruirlas sin adivinar a qué fecha corresponde cada importe.
 *
 * O sea que el problema no era el parser: era pedirle a alguien que consiga un
 * texto que su visor de PDF no le da.
 *
 * ── Qué cambia y qué NO cambia ─────────────────────────────────────────────
 *
 * Cambia la extracción. NO cambian las verificaciones: el resultado del modelo
 * pasa por `verificarResumen`, exactamente las mismas tres cuentas que el texto
 * pegado. Esto es lo importante de todo el archivo.
 *
 * Que las cuentas sean las mismas no es prolijidad: es lo que hace usable un
 * extractor no determinístico para plata. El resumen declara su propio total de
 * consumos, y la base del IVA dividida por los cargos de Meta tiene que dar el
 * mismo tipo de cambio que la base de la percepción dividida por el consumo
 * total. Un importe mal leído rompe al menos una de esas igualdades, y sin
 * pasarlas el resumen no se guarda.
 *
 * Dicho de otra forma: no confiamos en el modelo, lo verificamos. Y si algún
 * día falla, falla ruidosamente y del lado seguro.
 *
 * ── Por qué se le pide el documento y no una interpretación ────────────────
 *
 * El modelo transcribe: fechas, descripciones, cupones e importes tal como
 * están. No decide qué es un cargo de Meta, no convierte monedas, no suma, no
 * calcula el tipo de cambio ni clasifica impuestos. Todo eso lo hace el código
 * después, igual que con el texto pegado. Cada cosa que se le delega a un
 * modelo es una cosa que deja de ser verificable.
 */

import { openai } from "./openai"
import { MODELO_DOCUMENTOS } from "./ai-models"
import {
  aFechaISO,
  verificarResumen,
  type DatosDelResumen,
  type ImpuestoDelResumen,
  type LineaDelResumen,
  type ResumenAnalizado,
} from "./tarjeta-resumen"

/** 10 MB. Un resumen son 7 páginas; más que esto no es un resumen. */
export const MAXIMO_PDF_BYTES = 10 * 1024 * 1024

const INSTRUCCIONES = `Sos un transcriptor de resúmenes de tarjeta de crédito argentinos. Te paso el PDF de un resumen y tenés que devolver su contenido como JSON, SIN interpretar nada.

Devolvé EXCLUSIVAMENTE un objeto JSON con esta forma:

{
  "cierre": "DD-Mmm-YY",            // el valor de CIERRE ACTUAL
  "cierreAnterior": "DD-Mmm-YY",    // el de CIERRE ANTERIOR (en "Otros períodos")
  "vencimiento": "DD-Mmm-YY",       // el de VENCIMIENTO ACTUAL
  "totalDeclaradoPesos": 0.00,      // la columna PESOS de la línea TOTAL CONSUMOS
  "totalDeclaradoDolares": 0.00,    // la columna DÓLARES de esa misma línea
  "consumos": [
    {
      "fecha": "DD-Mmm-YY",
      "descripcion": "FACEBK *86QRGAW2R4   USD   7,70",  // tal cual, incluyendo la moneda y el importe de origen si están
      "cupon": "058306",            // los 6 dígitos de NRO. CUPÓN, o null
      "pesos": null,                // el importe de la columna PESOS, o null
      "dolares": 7.70               // el de la columna DÓLARES, o null
    }
  ],
  "impuestos": [
    { "descripcion": "IVA RG 4240 21%( 1629863,16)", "pesos": 342271.26 },
    { "descripcion": "IMPUESTO DE SELLOS    $", "pesos": 13364.03 },
    { "descripcion": "DB.RG 5617 30% ( 2628354,42 )", "pesos": 788506.32 },
    { "descripcion": "CR.RG 5617 30% M (M)", "pesos": -1256330.85 }
  ]
}

Reglas, todas importantes:

1. "consumos" son SÓLO las filas de las secciones de consumos del titular y de los adicionales. NO incluyas pagos ("SU PAGO EN PESOS", "SU PAGO EN USD"), ni impuestos, ni la línea TOTAL CONSUMOS, ni saldos.
2. Transcribí TODAS las filas de consumo, de todas las páginas. Si el resumen tiene 36, tienen que venir las 36. Una fila que falte invalida el resumen entero.
3. Los importes van como número JSON con punto decimal: "1.704,51" se escribe 1704.51. No uses separador de miles.
4. Cada consumo va con su importe en la columna que corresponde: si está en DÓLARES, "dolares"; si está en PESOS, "pesos"; el otro va en null. Si un consumo dice "AUD 30,00" y la columna DÓLARES dice 21,21, entonces "dolares" es 21.21 — el importe convertido, no el original.
5. En "descripcion" copiá el texto tal como aparece, con la moneda y el importe de origen incluidos si están. No lo normalices ni lo traduzcas.
6. En "impuestos" van las líneas de impuestos, cargos y percepciones con su fecha, incluidos los créditos con signo negativo. Copiá la descripción COMPLETA, con la base entre paréntesis cuando la haya: ese número se usa después.
7. No sumes, no promedies, no calcules tipos de cambio, no clasifiques. Sólo transcribí.
8. Si un dato no está en el PDF, poné null. No lo inventes ni lo deduzcas.

Devolvé el JSON y nada más: sin explicaciones, sin \`\`\`.`

/** El primer objeto JSON que aparezca en el texto. */
function extraerJSON(texto: string): any {
  const limpio = String(texto || "").trim()
  try {
    return JSON.parse(limpio)
  } catch {
    // Algunos modelos lo envuelven en ```json a pesar de la instrucción.
    const desde = limpio.indexOf("{")
    const hasta = limpio.lastIndexOf("}")
    if (desde < 0 || hasta <= desde) throw new Error("La respuesta del modelo no traía JSON")
    return JSON.parse(limpio.slice(desde, hasta + 1))
  }
}

function aNumeroONull(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null
  const n = typeof valor === "number" ? valor : Number(String(valor).replace(/\./g, "").replace(",", "."))
  return Number.isFinite(n) ? n : null
}

/**
 * Lee el PDF y devuelve el resumen YA VERIFICADO.
 *
 * El `ResumenAnalizado` que sale de acá es indistinguible del que sale del
 * texto pegado, incluidas sus `verificaciones` y sus `problemas`: el endpoint y
 * la pantalla no tienen que saber de dónde vino.
 */
export async function leerResumenDelPDF(
  pdf: Buffer,
  nombreDelArchivo = "resumen.pdf",
): Promise<ResumenAnalizado & { modelo: string }> {
  if (pdf.length === 0) throw new Error("El archivo llegó vacío")
  if (pdf.length > MAXIMO_PDF_BYTES) {
    throw new Error(`El PDF pesa ${(pdf.length / 1024 / 1024).toFixed(1)} MB y el máximo es 10 MB`)
  }

  const respuesta = await openai.responses.create({
    model: MODELO_DOCUMENTOS,
    // Sin creatividad: es una transcripción.
    temperature: 0,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: INSTRUCCIONES },
          {
            type: "input_file",
            filename: nombreDelArchivo,
            file_data: `data:application/pdf;base64,${pdf.toString("base64")}`,
          },
        ],
      },
    ],
  } as any)

  const texto = (respuesta as any)?.output_text
  if (!texto) throw new Error("El modelo no devolvió texto")

  const verificado = verificarResumen(datosDesdeElJSON(extraerJSON(texto)))

  console.log(
    `[TARJETA_IA] ${nombreDelArchivo}: ${verificado.lineas.length} consumos, ` +
      `${verificado.impuestos.length} impuestos, cierre ${verificado.cierre}, ` +
      `${verificado.problemas.length} problemas`,
  )

  return { ...verificado, modelo: MODELO_DOCUMENTOS }
}

/**
 * Del JSON del modelo a la forma que ya verifica el código.
 *
 * ── Qué decide esta función, y por qué ella ──────────────────────────────────
 *
 * Lo que el modelo NO decide: qué es un cargo de Meta y qué es un costo fijo,
 * qué impuesto computa y cuál no. Son las mismas reglas que usa el parser de
 * texto, y viven en el código para que un cambio de criterio no pueda quedar
 * aplicado en un camino y no en el otro.
 *
 * Está exportada y es pura para poder probarla con un JSON cualquiera, sin
 * llamar a la API: así se puede verificar que un resumen bien transcripto pasa
 * y que uno con una línea de menos o un importe cambiado NO pasa — que es la
 * única garantía que importa de todo este camino.
 */
export function datosDesdeElJSON(crudo: any): DatosDelResumen {
  const consumos = Array.isArray(crudo?.consumos) ? crudo.consumos : []

  const lineas: LineaDelResumen[] = []
  let consumosARS = 0

  for (const c of consumos) {
    const fecha = aFechaISO(String(c?.fecha ?? ""))
    const descripcion = String(c?.descripcion ?? "").replace(/\s+/g, " ").trim()
    if (!fecha || !descripcion) continue

    const dolares = aNumeroONull(c?.dolares)
    const pesos = aNumeroONull(c?.pesos)

    // Un consumo en pesos no es un costo nuestro en dólares: se cuenta aparte
    // para que la verificación contra el total declarado pueda cerrar.
    if (dolares === null) {
      if (pesos !== null) consumosARS += pesos
      continue
    }

    const cupon = c?.cupon ? String(c.cupon).trim() : undefined
    lineas.push({
      fecha,
      descripcion,
      cupon: cupon || undefined,
      importeUSD: dolares,
      categoria: /FACEBK|FACEBOOK|\bMETA\b/i.test(descripcion) ? "meta" : "otro",
    })
  }

  const impuestos: ImpuestoDelResumen[] = (Array.isArray(crudo?.impuestos) ? crudo.impuestos : [])
    .map((i: any) => {
      const descripcion = String(i?.descripcion ?? "").replace(/\s+/g, " ").trim()
      const importeARS = aNumeroONull(i?.pesos)
      if (!descripcion || importeARS === null) return null
      const base = /\(\s*([\d.,]+)\s*\)/.exec(descripcion)
      const d = descripcion.toUpperCase()
      return {
        id: d.includes("IVA RG 4240")
          ? "iva_rg4240"
          : d.includes("IMPUESTO DE SELLOS")
            ? "sellos"
            : d.includes("RG 5617")
              ? "rg5617"
              : "otro",
        descripcion,
        importeARS,
        baseARS: base ? aNumeroONull(base[1]) ?? undefined : undefined,
        // La percepción del 30 % va y vuelve: no se computa. Misma regla que
        // el parser de texto.
        computa: !d.includes("RG 5617"),
      } as ImpuestoDelResumen
    })
    .filter((i: ImpuestoDelResumen | null): i is ImpuestoDelResumen => i !== null)

  return {
    cierre: aFechaISO(String(crudo?.cierre ?? "")),
    cierreAnterior: aFechaISO(String(crudo?.cierreAnterior ?? "")),
    vencimiento: aFechaISO(String(crudo?.vencimiento ?? "")),
    lineas,
    impuestos,
    totalDeclaradoUSD: aNumeroONull(crudo?.totalDeclaradoDolares),
    totalDeclaradoARS: aNumeroONull(crudo?.totalDeclaradoPesos),
    consumosARS,
  }
}
