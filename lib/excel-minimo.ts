/**
 * Un escritor de .xlsx mínimo, sin dependencias (2/11/2026).
 *
 * ── Por qué escrito a mano y no con una librería ───────────────────────────
 *
 * Porque el proyecto no tiene ninguna, y agregarla tenía un costo concreto:
 * en este entorno no se puede instalar (el registro de npm está bloqueado), así
 * que un `import` de una librería nueva deja el typecheck roto hasta que Vercel
 * compile. O sea que el código se subiría sin haberlo podido compilar NI
 * probar, para generar un archivo que se le manda a la empresa que nos
 * contrata.
 *
 * Un .xlsx es un ZIP con cuatro XML adentro y un formato bien documentado. Son
 * 150 líneas que SÍ se pueden correr y verificar acá mismo: se genera el
 * archivo, se abre con otra herramienta y se comparan los valores celda por
 * celda. Es menos código del que haría falta para envolver una librería.
 *
 * ── Qué hace y qué no ──────────────────────────────────────────────────────
 *
 * Una hoja por archivo, con encabezados en negrita, números con formato de
 * miles y de moneda, y ancho de columna. No hace fórmulas, ni gráficos, ni
 * varias hojas, ni celdas combinadas: nada de eso hace falta para un detalle
 * que se manda por mail, y cada cosa que no está es una cosa que no se puede
 * romper.
 *
 * ── Decisiones del formato ─────────────────────────────────────────────────
 *
 * · Textos como `inlineStr` en vez de la tabla de cadenas compartidas: un XML
 *   menos y ninguna indirección. Para unas decenas de filas no cambia nada.
 * · ZIP sin compresión (método "store"). Un archivo de 10 KB no necesita
 *   comprimirse, y así no hay que coordinar deflate con los tamaños
 *   declarados en la cabecera.
 * · Los números van como números, no como texto. Es la diferencia entre una
 *   planilla con la que se puede trabajar y una captura de pantalla en celdas.
 */

/** Formatos disponibles para una celda. Se traducen a los estilos del archivo. */
export type FormatoDeCelda =
  | "texto"
  | "encabezado"
  | "entero"
  | "usd"
  | "usdPrecio"
  | "ars"
  | "textoFuerte"
  | "enteroFuerte"
  | "usdFuerte"
  | "arsFuerte"

export interface Celda {
  v: string | number | null
  f?: FormatoDeCelda
}

/** El orden define el índice de estilo (`s`) que se escribe en cada celda. */
const ESTILOS: FormatoDeCelda[] = [
  "texto",
  "encabezado",
  "entero",
  "usd",
  "usdPrecio",
  "ars",
  "textoFuerte",
  "enteroFuerte",
  "usdFuerte",
  "arsFuerte",
]

function indiceDeEstilo(f: FormatoDeCelda = "texto"): number {
  const i = ESTILOS.indexOf(f)
  return i < 0 ? 0 : i
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Los caracteres de control rompen el XML y Excel abre el archivo con un
    // cartel de "contenido ilegible", que es indistinguible de un archivo
    // corrupto. Un nombre de cliente pegado de otro sistema puede traerlos.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
}

/** "A", "B", … "Z", "AA". */
function letraDeColumna(n: number): string {
  let s = ""
  let x = n
  while (x >= 0) {
    s = String.fromCharCode(65 + (x % 26)) + s
    x = Math.floor(x / 26) - 1
  }
  return s
}

// ── CRC32, que el ZIP exige incluso sin comprimir ───────────────────────────
const TABLA_CRC = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

interface EntradaZip {
  nombre: string
  datos: Buffer
}

/**
 * Un ZIP sin compresión con las entradas dadas.
 *
 * Se implementa sólo lo que el formato pide: cabecera por archivo, directorio
 * central y su cierre. Sin ZIP64, sin descriptores de datos, sin
 * encriptación — nada de eso aplica a cuatro XML de pocos KB.
 */
function armarZip(entradas: EntradaZip[]): Buffer {
  const locales: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const e of entradas) {
    const nombre = Buffer.from(e.nombre, "utf8")
    const crc = crc32(e.datos)

    const cabecera = Buffer.alloc(30)
    cabecera.writeUInt32LE(0x04034b50, 0) // firma
    cabecera.writeUInt16LE(20, 4) // versión necesaria
    cabecera.writeUInt16LE(0, 6) // banderas
    cabecera.writeUInt16LE(0, 8) // método: store
    cabecera.writeUInt16LE(0, 10) // hora
    cabecera.writeUInt16LE(0, 12) // fecha
    cabecera.writeUInt32LE(crc, 14)
    cabecera.writeUInt32LE(e.datos.length, 18) // comprimido
    cabecera.writeUInt32LE(e.datos.length, 22) // sin comprimir
    cabecera.writeUInt16LE(nombre.length, 26)
    cabecera.writeUInt16LE(0, 28) // extra
    locales.push(cabecera, nombre, e.datos)

    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(20, 4) // versión que lo creó
    dir.writeUInt16LE(20, 6) // versión necesaria
    dir.writeUInt16LE(0, 8)
    dir.writeUInt16LE(0, 10)
    dir.writeUInt16LE(0, 12)
    dir.writeUInt16LE(0, 14)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(e.datos.length, 20)
    dir.writeUInt32LE(e.datos.length, 24)
    dir.writeUInt16LE(nombre.length, 28)
    dir.writeUInt16LE(0, 30)
    dir.writeUInt16LE(0, 32) // comentario
    dir.writeUInt16LE(0, 34) // disco
    dir.writeUInt16LE(0, 36) // atributos internos
    dir.writeUInt32LE(0, 38) // atributos externos
    dir.writeUInt32LE(offset, 42)
    central.push(dir, nombre)

    offset += cabecera.length + nombre.length + e.datos.length
  }

  const cuerpo = Buffer.concat(locales)
  const directorio = Buffer.concat(central)
  const fin = Buffer.alloc(22)
  fin.writeUInt32LE(0x06054b50, 0)
  fin.writeUInt16LE(0, 4)
  fin.writeUInt16LE(0, 6)
  fin.writeUInt16LE(entradas.length, 8)
  fin.writeUInt16LE(entradas.length, 10)
  fin.writeUInt32LE(directorio.length, 12)
  fin.writeUInt32LE(cuerpo.length, 16)
  fin.writeUInt16LE(0, 20)

  return Buffer.concat([cuerpo, directorio, fin])
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`

/**
 * Los estilos.
 *
 * Los formatos de número propios arrancan en 164 porque los anteriores están
 * reservados por el estándar. El orden de `cellXfs` tiene que seguir el de
 * `ESTILOS`: el índice que se escribe en cada celda es la posición acá.
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4">
<numFmt numFmtId="164" formatCode="#,##0"/>
<numFmt numFmtId="165" formatCode="&quot;US$ &quot;#,##0.00"/>
<numFmt numFmtId="166" formatCode="&quot;US$ &quot;#,##0.000000"/>
<numFmt numFmtId="167" formatCode="&quot;$ &quot;#,##0.00"/>
</numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEEEEE"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="167" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

export interface HojaDeCalculo {
  /** Hasta 31 caracteres y sin : \\ / ? * [ ], que Excel rechaza. */
  nombre: string
  filas: Celda[][]
  /** Ancho de cada columna, en caracteres. */
  anchos?: number[]
}

/** El .xlsx completo, listo para servir o guardar. */
export function construirXLSX(hoja: HojaDeCalculo): Buffer {
  const nombreSeguro = hoja.nombre.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Hoja1"

  const columnas = hoja.anchos?.length
    ? `<cols>${hoja.anchos
        .map((a, i) => `<col min="${i + 1}" max="${i + 1}" width="${a}" customWidth="1"/>`)
        .join("")}</cols>`
    : ""

  const filas = hoja.filas
    .map((celdas, f) => {
      const numero = f + 1
      const cuerpo = celdas
        .map((c, i) => {
          const ref = `${letraDeColumna(i)}${numero}`
          const s = indiceDeEstilo(c.f)
          if (c.v === null || c.v === undefined || c.v === "") {
            // Se escribe la celda igual, con su estilo: así la fila mantiene
            // el ancho y el formato, y un hueco se ve como un hueco.
            return `<c r="${ref}" s="${s}"/>`
          }
          if (typeof c.v === "number" && Number.isFinite(c.v)) {
            return `<c r="${ref}" s="${s}"><v>${c.v}</v></c>`
          }
          return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${escapar(String(c.v))}</t></is></c>`
        })
        .join("")
      return `<row r="${numero}">${cuerpo}</row>`
    })
    .join("")

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${columnas}<sheetData>${filas}</sheetData></worksheet>`

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapar(nombreSeguro)}" sheetId="1" r:id="rId1"/></sheets></workbook>`

  return armarZip([
    { nombre: "[Content_Types].xml", datos: Buffer.from(CONTENT_TYPES, "utf8") },
    { nombre: "_rels/.rels", datos: Buffer.from(RELS, "utf8") },
    { nombre: "xl/workbook.xml", datos: Buffer.from(workbook, "utf8") },
    { nombre: "xl/_rels/workbook.xml.rels", datos: Buffer.from(WORKBOOK_RELS, "utf8") },
    { nombre: "xl/styles.xml", datos: Buffer.from(STYLES, "utf8") },
    { nombre: "xl/worksheets/sheet1.xml", datos: Buffer.from(sheet, "utf8") },
  ])
}
