/**
 * Archivos que manda el PACIENTE (21/9/2026).
 *
 * El camino inverso al del panel. `lib/media-validacion.ts` decide qué puede
 * subir un agente; este módulo interpreta lo que ya llegó, que es un problema
 * distinto: al paciente no se le puede rechazar nada. Cuando el webhook nos
 * avisa, el archivo ya existe.
 *
 * ── Lo que había antes ─────────────────────────────────────────────────────
 *
 * `extractMessageContent` en lib/whatsapp.tsx tenía casos para text, button,
 * interactive y audio. Una imagen o un PDF caían en `default: { content: "" }`.
 * Consecuencia doble, y las dos silenciosas:
 *
 *  - Con un agente asignado, el mensaje se guardaba con contenido vacío: el
 *    panel mostraba una burbuja en blanco. El agente no se enteraba de que el
 *    paciente había mandado algo; se enteraba de que había mandado *nada*.
 *
 *  - Sin agente, el string vacío recorría el embudo entero —dispatcher,
 *    interceptores, NLU fallback— exactamente como pasaba con los audios antes
 *    del 14/9. El paciente mandaba la foto de su orden médica y recibía un menú.
 *
 * Y el `media_id` se perdía. Ese id vive 7 días y no hay endpoint de Meta para
 * listar los archivos pasados de un número: si no se captura en el momento del
 * webhook, el archivo deja de existir para nosotros. Por eso la extracción es lo
 * primero que pasa, antes de cualquier decisión de ruteo.
 *
 * ── Por qué no miramos el tamaño acá ───────────────────────────────────────
 *
 * El webhook trae `id`, `mime_type`, `sha256` y —solo en documentos—
 * `filename`. No trae el tamaño. Averiguarlo cuesta una llamada más a Graph en
 * el camino caliente del webhook, que tiene que responder rápido. El tope se
 * controla donde el archivo efectivamente se descarga (el GET de
 * /api/support/media), que además es el único lugar donde el tamaño importa.
 * `tamanoBytes: 0` significa "todavía no lo sabemos", y la interfaz lo omite.
 */

import { DIAS_RETENCION_ENTRANTE } from "./media-validacion"
import type { MediaAdjunta, TipoMediaEntrante } from "./types"

/**
 * Motivo con el que se crea la sesión de atención cuando el paciente manda un
 * archivo sin tener una abierta. No está en HUMAN_SUPPORT_REASONS a propósito:
 * ese catálogo es el menú que elige el paciente, y este motivo no se elige — lo
 * asigna el sistema al ver el archivo.
 */
export const MOTIVO_ARCHIVO = "Envío de archivo"

/** Los tipos de mensaje de WhatsApp que traen un archivo adjunto. */
const TIPOS_CON_ARCHIVO = ["image", "document", "video"] as const

/**
 * Lo que el panel puede mostrar incrustado. El resto se ofrece para descargar.
 *
 * La lista es la misma que la de salida y no por casualidad: son los tipos cuya
 * firma sabemos reconocer por contenido (ver `detectarTipoReal`). Servir
 * incrustado algo cuyo tipo real no verificamos sería ejecutar en el origen del
 * panel un archivo que eligió un tercero.
 */
const PREVISUALIZABLES = new Set(["image/jpeg", "image/png", "application/pdf"])

/** Extensión a usar cuando WhatsApp no manda nombre (imágenes y videos nunca lo traen). */
const EXTENSION_POR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
}

export interface MediaEntranteLeida {
  media: MediaAdjunta
  /** El texto que el paciente escribió junto al archivo. Puede venir vacío. */
  caption: string
}

function normalizarMime(mimeType: string): string {
  return (mimeType || "").split(";")[0].trim().toLowerCase()
}

export function esPrevisualizable(mimeType: string): boolean {
  return PREVISUALIZABLES.has(normalizarMime(mimeType))
}

/**
 * Nombre para mostrar. Las imágenes y los videos de WhatsApp no traen ninguno,
 * así que se arma uno legible: es lo que va a ver el agente en la lista y lo que
 * se va a llamar el archivo cuando lo baje.
 */
function nombreParaMostrar(
  tipo: TipoMediaEntrante,
  mimeType: string,
  nombreOriginal: string | undefined,
  timestamp: string | undefined,
): string {
  const propio = (nombreOriginal || "").split(/[/\\]/).pop()?.trim()
  // eslint-disable-next-line no-control-regex
  if (propio) return propio.replace(/[\x00-\x1f\x7f"']/g, "").slice(0, 100)

  const ext = EXTENSION_POR_MIME[normalizarMime(mimeType)] || normalizarMime(mimeType).split("/")[1] || "bin"
  const prefijo = tipo === "image" ? "imagen" : tipo === "video" ? "video" : "archivo"

  // El timestamp del webhook viene en segundos. Sirve para distinguir cinco
  // fotos mandadas seguidas, que si no se llamarían todas igual.
  const segundos = Number(timestamp)
  const marca = Number.isFinite(segundos) && segundos > 0
    ? new Date(segundos * 1000).toISOString().slice(0, 19).replace(/[:T]/g, "-")
    : new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")

  return `${prefijo}-${marca}.${ext}`
}

/**
 * Lee el archivo de un mensaje del webhook. Devuelve null si el mensaje no trae
 * ninguno — que es el caso de la enorme mayoría.
 *
 * El audio queda deliberadamente afuera: ya tiene su propio camino (se
 * transcribe y se normaliza a texto antes de rutear, ver lib/whatsapp.tsx).
 * Meterlo acá lo mandaría a atención humana en vez de transcribirlo, que sería
 * un cambio de comportamiento que nadie pidió.
 */
export function leerMediaDelWebhook(message: any): MediaEntranteLeida | null {
  const tipo = message?.type as TipoMediaEntrante
  if (!TIPOS_CON_ARCHIVO.includes(tipo as any)) return null

  const nodo = message?.[tipo]
  if (!nodo?.id) return null

  const mimeType = normalizarMime(nodo.mime_type) || "application/octet-stream"

  const media: MediaAdjunta = {
    mediaId: String(nodo.id),
    tipo,
    mimeType,
    nombreArchivo: nombreParaMostrar(tipo, mimeType, nodo.filename, message?.timestamp),
    // Ver la nota de cabecera: el webhook no lo trae y no vale una llamada extra.
    tamanoBytes: 0,
    disponibleHasta: new Date(
      Date.now() + DIAS_RETENCION_ENTRANTE * 24 * 60 * 60 * 1000,
    ).toISOString(),
    direccion: "entrante",
  }

  return { media, caption: String(nodo.caption || "").trim() }
}

/**
 * El texto que se guarda como `content` del mensaje.
 *
 * Mismo criterio que el `[Archivo enviado: …]` del panel: el mensaje tiene que
 * leerse bien donde no se puede renderizar nada —el monitor del dashboard, el
 * resumen que se le inyecta a la IA al cerrar la sesión— y nunca puede quedar
 * vacío, porque un contenido vacío es justamente lo que rompía todo.
 */
export function describirArchivoRecibido(media: MediaAdjunta, caption: string): string {
  const etiqueta =
    media.tipo === "image" ? "Imagen recibida" : media.tipo === "video" ? "Video recibido" : "Archivo recibido"
  const marcador = `[${etiqueta}: ${media.nombreArchivo}]`
  const texto = (caption || "").trim()
  return texto ? `${texto}\n${marcador}` : marcador
}

/** Saca el marcador para mostrar el mensaje en un panel que sí dibuja el archivo. */
export function textoSinMarcadorRecibido(contenido: string): string {
  return (contenido || "").replace(/\n?\[(?:Imagen|Video|Archivo) recibid[oa]: [^\]]*\]/g, "").trim()
}

/**
 * Los dos mensajes que recibe el paciente, acá y no incrustados en whatsapp.tsx,
 * para poder testear lo que tienen de delicado: las palabras que usan.
 *
 * ── La trampa (21/9/2026) ──────────────────────────────────────────────────
 *
 * Ninguno puede contener la frase "asistente virtual". Suena al revés de lo que
 * uno esperaría, pero `presentarSiCorresponde` usa
 * `YA_SE_PRESENTA = /asistente virtual|bienvenid/i` para no presentarse dos
 * veces: si el mensaje ya trae esa frase, el embudo lo deja intacto y el
 * paciente se queda sin el saludo del primer mensaje del día.
 *
 * Pasó exactamente eso en la primera versión, que decía "como soy un asistente
 * virtual de inteligencia artificial y no puedo abrirlo". La identificación la
 * pone el embudo; estos textos solo dicen qué pasa con el archivo.
 *
 * Los tests de abajo lo verifican contra `anteponerPresentacion` de verdad, no
 * contra una copia de la regex.
 */
export function mensajeDerivacionPorArchivo(horariosSiEstaCerrado?: string | null): string {
  let texto =
    "Recibí tu archivo. No puedo abrirlo desde acá, " +
    "así que te derivo con una persona del equipo para que lo revise."

  if (horariosSiEstaCerrado !== undefined && horariosSiEstaCerrado !== null) {
    const entreParentesis = horariosSiEstaCerrado ? ` (${horariosSiEstaCerrado})` : ""
    texto += `\n\n_En este momento estamos fuera del horario de atención${entreParentesis}. Te van a responder dentro de ese horario._`
  }

  return texto
}

/** Regla 2: la clínica no tiene atención humana, así que nadie va a poder abrirlo. */
export function mensajeSinAtencionHumana(clinica?: string | null): string {
  return (
    "Recibí tu archivo, pero por este canal no podemos abrirlo. " +
    `Si es una orden, un estudio o una receta, lo mejor es que lo lleves o lo consultes directamente con ${clinica || "la clínica"}.\n\n` +
    "Si querés, contame por acá qué necesitás y te ayudo con turnos."
  )
}

const SUFIJO_ARCHIVOS = /\s*\((\d+) archivos?\)$/

/**
 * Suma un archivo a la cuenta del motivo de una sesión.
 *
 * Se usa en los dos lados: al crear la sesión porque llegó un archivo
 * (`anotarArchivosEnMotivo(MOTIVO_ARCHIVO)` → "Envío de archivo (1 archivo)") y
 * al sumar uno a una sesión que ya existe con otro motivo
 * ("Estudios" → "Estudios (1 archivo)" → "Estudios (2 archivos)").
 *
 * Cuenta en vez de repetir. Un paciente que fotografía una orden médica manda
 * cuatro o cinco fotos seguidas, y un motivo con la misma frase pegada cinco
 * veces no le dice nada al agente. Al contar, cada llamada agrega información:
 * el agente sabe cuántos archivos lo están esperando antes de abrir la sesión.
 */
export function anotarArchivosEnMotivo(motivo: string): string {
  const crudo = (motivo || "").trim() || MOTIVO_ARCHIVO
  const yaAnotado = crudo.match(SUFIJO_ARCHIVOS)
  const base = yaAnotado ? crudo.replace(SUFIJO_ARCHIVOS, "") : crudo
  const n = (yaAnotado ? Number(yaAnotado[1]) : 0) + 1
  return `${base} (${n} archivo${n === 1 ? "" : "s"})`
}
