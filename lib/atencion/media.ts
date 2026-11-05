/**
 * Los archivos y audios del chat, guardados donde no se caen (5/11/2026).
 *
 * ── Por qué no se guardan en WhatsApp ──────────────────────────────────────
 *
 * Porque el pedido es que la conversación de hoy se vea en dos meses, con sus
 * archivos. WhatsApp conserva lo que subimos 30 días, y lo que manda un
 * paciente 7. A los dos meses el historial mostraría una fila de carteles
 * "caducado", que es exactamente lo que se quería evitar.
 *
 * ── Redis en base64, como el PDF del resumen de tarjeta ───────────────────
 *
 * El proyecto no tiene almacenamiento de archivos: los media de WhatsApp se le
 * piden a Meta en el momento. La alternativa era agregar Vercel Blob —una
 * dependencia, un store que hay que crear y un token que hay que configurar—
 * y el precedente de hace tres días dice que Redis alcanza: el PDF del
 * resumen de tarjeta se guarda así, con tope de 4 MB.
 *
 * Las cuentas: una foto de una receta son 300 KB, un audio de un minuto en
 * opus unos 500 KB. Mil archivos de esos son 400 MB, que en Upstash son
 * centavos por mes. Si algún día el volumen cambia de orden, lo que hay que
 * reemplazar es este archivo y nada más: todo lo demás habla con `guardar` y
 * `leer`.
 *
 * ── Cada archivo en su propia clave ───────────────────────────────────────
 *
 * Nunca junto a la conversación. `leerConversacion` se llama en cada consulta
 * del chat —cada 5 segundos— y traería todos los adjuntos en base64 para no
 * mostrar ninguno. Es el mismo error que ya evitamos con los PDF de tarjeta.
 */

import { nanoid } from "nanoid"
import { getRedisClient } from "../redis"
import type { MediaAdjunta } from "../types"

const PREFIJO = "atencion:media:"
const PREFIJO_META = "atencion:media:meta:"

const MB = 1024 * 1024

/**
 * Tope por archivo.
 *
 * El mismo que el panel usa para subir (`LIMITE_SUBIDA_PANEL`). En base64 un
 * archivo ocupa un 33 % más, así que 4 MB son 5,3 MB en Redis: lejos de
 * cualquier límite y suficiente para una foto de un estudio.
 */
export const LIMITE_ARCHIVO = 4 * MB

/** Tope del audio. Dos minutos de voz en opus no llegan a esto. */
export const LIMITE_AUDIO = 4 * MB

/**
 * Lo que el chat acepta subir.
 *
 * Los tres primeros son los que ya acepta el panel —`media-validacion.ts`— así
 * que lo que sube un paciente es lo mismo que puede recibir y mandar un
 * agente. Los de audio los agrega este chat: `MediaRecorder` produce webm/opus
 * en Chrome y Android, ogg en Firefox, y mp4/aac en Safari e iOS. Aceptar los
 * cuatro es lo que hace que la grabación funcione en los cuatro.
 */
const TIPOS: Array<{ mime: string; tipo: MediaAdjunta["tipo"]; extension: string; limite: number }> = [
  { mime: "image/jpeg", tipo: "image", extension: "jpg", limite: LIMITE_ARCHIVO },
  { mime: "image/png", tipo: "image", extension: "png", limite: LIMITE_ARCHIVO },
  { mime: "application/pdf", tipo: "document", extension: "pdf", limite: LIMITE_ARCHIVO },
  { mime: "audio/webm", tipo: "audio", extension: "webm", limite: LIMITE_AUDIO },
  { mime: "audio/ogg", tipo: "audio", extension: "ogg", limite: LIMITE_AUDIO },
  { mime: "audio/mp4", tipo: "audio", extension: "m4a", limite: LIMITE_AUDIO },
  { mime: "audio/mpeg", tipo: "audio", extension: "mp3", limite: LIMITE_AUDIO },
]

/** "audio/webm;codecs=opus" → "audio/webm". */
function normalizar(mimeType: string): string {
  const base = (mimeType || "").split(";")[0].trim().toLowerCase()
  if (base === "image/jpg" || base === "image/pjpeg") return "image/jpeg"
  if (base === "image/x-png") return "image/png"
  if (base === "audio/x-m4a") return "audio/mp4"
  return base
}

export type Validacion =
  | { valido: true; tipo: MediaAdjunta["tipo"]; mimeType: string; extension: string }
  | { valido: false; motivo: string }

export function validarSubidaDelChat(params: { mimeType: string; bytes: number }): Validacion {
  const mime = normalizar(params.mimeType)
  const permitido = TIPOS.find((t) => t.mime === mime)

  if (!permitido) {
    return {
      valido: false,
      motivo: "Se pueden enviar fotos (JPG o PNG), documentos PDF y audios grabados acá.",
    }
  }
  if (!Number.isFinite(params.bytes) || params.bytes <= 0) {
    return { valido: false, motivo: "El archivo está vacío o no se pudo leer." }
  }
  if (params.bytes > permitido.limite) {
    const mb = (permitido.limite / MB).toFixed(0)
    return { valido: false, motivo: `El archivo es muy grande. El máximo es ${mb} MB.` }
  }

  return { valido: true, tipo: permitido.tipo, mimeType: mime, extension: permitido.extension }
}

/**
 * Nuestros ids llevan prefijo.
 *
 * Es lo que permite que una sola ruta sirva los adjuntos del chat y los de
 * WhatsApp sin un campo extra en `MediaAdjunta` —que habría que agregar en los
 * dos lados y migrar en los mensajes ya guardados—. El prefijo viaja en el
 * propio id, así que un mensaje viejo sigue funcionando sin tocarlo.
 */
export const PREFIJO_ID = "web_"

export function esMediaDelChat(mediaId: string): boolean {
  return typeof mediaId === "string" && mediaId.startsWith(PREFIJO_ID)
}

/**
 * Hasta cuándo está disponible.
 *
 * `MediaAdjunta.disponibleHasta` existe porque los de WhatsApp caducan, y
 * `AdjuntoDelMensaje` muestra "caducado" cuando la fecha pasó. Los nuestros no
 * caducan, así que va una fecha lejana: así el panel los muestra siempre sin
 * tener que aprender que existe otro origen.
 */
function disponibleParaSiempre(): string {
  return new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString()
}

export interface ArchivoGuardado {
  media: MediaAdjunta
}

/** Guarda el archivo y devuelve el adjunto listo para el mensaje. */
export async function guardarMediaDelChat(params: {
  contenido: Buffer
  mimeType: string
  tipo: MediaAdjunta["tipo"]
  extension: string
  nombreArchivo?: string
}): Promise<ArchivoGuardado | null> {
  const redis = getRedisClient()
  if (!redis) return null

  const id = `${PREFIJO_ID}${nanoid()}`

  // El nombre: lo que mandó el navegador, limpio, o uno armado. Sin
  // separadores de ruta ni caracteres de control, por lo mismo que en
  // `media-validacion.ts`: este nombre se muestra y viaja en un header.
  const crudo = (params.nombreArchivo || "").split(/[/\\]/).pop() || ""
  // eslint-disable-next-line no-control-regex
  const limpio = crudo.replace(/[\x00-\x1f\x7f"']/g, "").trim().slice(0, 100)
  const nombre =
    limpio && limpio.toLowerCase().endsWith(`.${params.extension}`)
      ? limpio
      : `${limpio || (params.tipo === "audio" ? "audio" : "archivo")}.${params.extension}`

  const media: MediaAdjunta = {
    mediaId: id,
    tipo: params.tipo,
    mimeType: params.mimeType,
    nombreArchivo: nombre,
    tamanoBytes: params.contenido.length,
    disponibleHasta: disponibleParaSiempre(),
    direccion: "entrante",
  }

  try {
    // Sin TTL: es el punto de guardarlo acá y no en WhatsApp.
    await redis.set(`${PREFIJO}${id}`, params.contenido.toString("base64"))
    await redis.set(`${PREFIJO_META}${id}`, JSON.stringify(media))
    return { media }
  } catch (error) {
    console.error("[ATENCION_MEDIA] No se pudo guardar el archivo:", error)
    return null
  }
}

export interface MediaLeida {
  contenido: Buffer
  media: MediaAdjunta
}

/** El archivo, o `null` si no está. */
export async function leerMediaDelChat(id: string): Promise<MediaLeida | null> {
  const redis = getRedisClient()
  if (!redis || !esMediaDelChat(id)) return null

  try {
    const [crudo, meta] = await Promise.all([
      redis.get(`${PREFIJO}${id}`),
      redis.get(`${PREFIJO_META}${id}`),
    ])
    if (!crudo || typeof crudo !== "string" || !meta) return null

    const media = typeof meta === "string" ? JSON.parse(meta) : meta
    if (!media?.mediaId) return null

    return { contenido: Buffer.from(crudo, "base64"), media: media as MediaAdjunta }
  } catch (error) {
    console.error(`[ATENCION_MEDIA] No se pudo leer ${id}:`, error)
    return null
  }
}
