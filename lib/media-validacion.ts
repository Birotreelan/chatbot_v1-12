/**
 * Validación de archivos adjuntos — imágenes y PDFs (15/9/2026).
 *
 * Está separada de lib/whatsapp-media.ts a propósito: este módulo es puro (no
 * hace red, no lee credenciales, no importa nada del servidor) para que el
 * panel pueda usar EXACTAMENTE las mismas reglas en el navegador.
 *
 * Que sean las mismas reglas es el punto. Si el cliente validara por su cuenta,
 * las dos validaciones se desincronizarían con el primer cambio y el agente
 * vería un archivo aceptado por la interfaz y rechazado por el servidor.
 *
 * La validación del cliente es por comodidad: avisa sin esperar la subida. La
 * del servidor es la que manda, porque el cliente se puede saltear.
 *
 * Límites según https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media
 */

export type TipoMedia = "image" | "document"

interface TipoPermitido {
  mimeType: string
  tipo: TipoMedia
  extension: string
  etiqueta: string
  /** Tope de WhatsApp para este tipo, en bytes. */
  limiteWhatsApp: number
}

const MB = 1024 * 1024

/** Días que WhatsApp conserva un archivo que subimos nosotros. */
export const DIAS_RETENCION_WHATSAPP = 30

/** Días que WhatsApp conserva un archivo que manda el paciente (id de webhook). */
export const DIAS_RETENCION_ENTRANTE = 7

/**
 * Los únicos tres tipos que aceptamos. La lista es corta a propósito: el panel
 * reenvía al paciente lo que el agente sube, así que cada formato habilitado es
 * un formato que podemos terminar entregando. PDF e imágenes cubren
 * indicaciones, órdenes y estudios, que es para lo que se pidió.
 */
const TIPOS_PERMITIDOS: TipoPermitido[] = [
  { mimeType: "image/jpeg", tipo: "image", extension: "jpg", etiqueta: "imagen JPG", limiteWhatsApp: 5 * MB },
  { mimeType: "image/png", tipo: "image", extension: "png", etiqueta: "imagen PNG", limiteWhatsApp: 5 * MB },
  { mimeType: "application/pdf", tipo: "document", extension: "pdf", etiqueta: "documento PDF", limiteWhatsApp: 100 * MB },
]

/**
 * Tope real del envío desde el panel.
 *
 * WhatsApp aceptaría un PDF de 100 MB, pero el archivo tiene que pasar antes
 * por una función serverless de Vercel, que corta el body de la request en
 * ~4,5 MB. Dejamos 4 MB de margen: pasarse no falla en WhatsApp, falla antes,
 * en nuestra propia infraestructura, y con un error mucho menos claro.
 *
 * Si alguna vez hiciera falta enviar archivos más grandes, la salida es que el
 * navegador suba directo a un almacenamiento (Vercel Blob) y el servidor lea de
 * ahí — pero eso implica guardar el archivo, que es justo lo que se decidió no
 * hacer.
 */
export const LIMITE_SUBIDA_PANEL = 4 * MB

/** Para el atributo `accept` del input de archivo. */
export const EXTENSIONES_ACEPTADAS = ".jpg,.jpeg,.png,.pdf"
export const MIME_TYPES_ACEPTADOS = TIPOS_PERMITIDOS.map((t) => t.mimeType).join(",")

export type ResultadoValidacion =
  | { valido: true; tipo: TipoMedia; mimeType: string; nombreArchivo: string; etiqueta: string }
  | { valido: false; motivo: string }

/** "1,4 MB" — para mensajes que el agente pueda entender de una. */
export function formatearTamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < MB) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / MB).toFixed(1).replace(".", ",")} MB`
}

/**
 * Algunos navegadores y sistemas mandan variantes del mismo tipo. Las
 * normalizamos antes de comparar: `image/jpg` no existe formalmente pero
 * aparece seguido, y un mime con parámetros (`application/pdf; charset=...`)
 * tampoco matchea por igualdad.
 */
function normalizarMimeType(mimeType: string): string {
  const base = (mimeType || "").split(";")[0].trim().toLowerCase()
  if (base === "image/jpg" || base === "image/pjpeg") return "image/jpeg"
  if (base === "image/x-png") return "image/png"
  return base
}

/**
 * Deja el nombre en algo seguro de mostrar y de mandar en un header multipart:
 * sin separadores de ruta, sin caracteres de control, acotado. WhatsApp le
 * muestra este nombre al paciente cuando es un documento.
 */
function sanitizarNombre(nombre: string, extension: string): string {
  const sinRuta = (nombre || "").split(/[/\\]/).pop() || ""
  // eslint-disable-next-line no-control-regex
  const limpio = sinRuta.replace(/[\x00-\x1f\x7f"']/g, "").trim()
  const base = limpio.length > 0 ? limpio : `archivo.${extension}`
  const acotado = base.length > 100 ? base.slice(0, 100) : base

  // La extensión tiene que reflejar el tipo real: mandar un PDF llamado
  // "orden.jpg" es la causa habitual del error 131053 de WhatsApp.
  const terminaBien =
    acotado.toLowerCase().endsWith(`.${extension}`) ||
    (extension === "jpg" && acotado.toLowerCase().endsWith(".jpeg"))
  return terminaBien ? acotado : `${acotado}.${extension}`
}

/**
 * Valida tipo y tamaño ANTES de subir nada.
 *
 * Es pura y está testeada: es la primera barrera entre lo que el agente elige
 * en su computadora y lo que le llega al paciente.
 */
export function validarArchivo(params: {
  mimeType: string
  bytes: number
  nombreArchivo?: string
}): ResultadoValidacion {
  const mimeType = normalizarMimeType(params.mimeType)
  const permitido = TIPOS_PERMITIDOS.find((t) => t.mimeType === mimeType)

  if (!permitido) {
    return { valido: false, motivo: "Solo se pueden enviar imágenes JPG, PNG o documentos PDF." }
  }

  if (!Number.isFinite(params.bytes) || params.bytes <= 0) {
    return { valido: false, motivo: "El archivo está vacío o no se pudo leer." }
  }

  const limite = Math.min(permitido.limiteWhatsApp, LIMITE_SUBIDA_PANEL)
  if (params.bytes > limite) {
    return {
      valido: false,
      motivo: `El archivo pesa ${formatearTamano(params.bytes)} y el máximo es ${formatearTamano(limite)}.`,
    }
  }

  return {
    valido: true,
    tipo: permitido.tipo,
    mimeType: permitido.mimeType,
    etiqueta: permitido.etiqueta,
    nombreArchivo: sanitizarNombre(params.nombreArchivo || "", permitido.extension),
  }
}

/**
 * Mira los primeros bytes del archivo para saber qué es realmente.
 *
 * El `Content-Type` de un formulario lo declara el navegador a partir de la
 * extensión: cualquiera puede renombrar un ejecutable a `orden.pdf` y el
 * navegador va a decir `application/pdf`. Como el panel reenvía al paciente lo
 * que el agente sube, la declaración no alcanza — hay que mirar el contenido.
 *
 * Devuelve null si no reconoce la firma, y eso alcanza para rechazar: los tres
 * formatos que aceptamos tienen firmas fijas y conocidas.
 */
export function detectarTipoReal(buffer: Uint8Array): string | null {
  const b = buffer
  if (b.length < 8) return null

  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg"

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (PNG.every((byte, i) => b[i] === byte)) return "image/png"

  // PDF: "%PDF"
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf"

  return null
}
