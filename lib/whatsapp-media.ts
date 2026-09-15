/**
 * Envío de imágenes y documentos por WhatsApp Cloud API (15/9/2026).
 *
 * El envío es en dos pasos:
 *   1. Subir el archivo a POST /{phone-number-id}/media → devuelve un media_id
 *   2. Enviar el mensaje referenciando ese media_id
 *
 * ── Qué NO hace este módulo ────────────────────────────────────────────────
 *
 * No guarda el archivo. WhatsApp conserva lo que subimos durante 30 días y el
 * panel lo muestra pidiéndoselo a ellos (ver app/api/support/media/route.ts).
 * Es deliberado: son documentos clínicos, y no tenerlos en reposo en nuestra
 * infraestructura es una decisión de privacidad, no una omisión.
 *
 * La contracara es que el archivo desaparece del historial del panel a los 30
 * días. El agente tiene que saberlo en el momento de enviarlo, no descubrirlo
 * después — por eso la interfaz lo avisa al adjuntar.
 *
 * Las reglas de validación (qué tipos, qué tamaño) viven en
 * lib/media-validacion.ts, que es puro y lo comparte el navegador. Se
 * reexportan desde acá para que el servidor tenga un solo import.
 *
 * Fuente de los límites y del flujo:
 * https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media
 */

import { downloadWhatsAppMedia } from "./audio-transcription"
import { formatearTamano, type TipoMedia } from "./media-validacion"

export {
  validarArchivo,
  detectarTipoReal,
  formatearTamano,
  LIMITE_SUBIDA_PANEL,
  EXTENSIONES_ACEPTADAS,
  MIME_TYPES_ACEPTADOS,
  DIAS_RETENCION_WHATSAPP,
  DIAS_RETENCION_ENTRANTE,
} from "./media-validacion"
export type { TipoMedia, ResultadoValidacion } from "./media-validacion"

const GRAPH_API_VERSION = "v17.0"

/**
 * Traduce un error de la API de WhatsApp a algo que el agente pueda leer y
 * accionar.
 *
 * Sin esto, cuando la ventana de 24 horas está cerrada el panel muestra un
 * volcado de JSON de Meta y el agente reintenta pensando que fue una falla
 * transitoria. Devolvemos también el código para poder distinguir en el
 * cliente el caso de ventana cerrada, que no es un error nuestro.
 */
export function interpretarErrorDeWhatsApp(error: any): { mensaje: string; codigo?: number } {
  const detalle = error?.error || error
  const codigo: number | undefined = typeof detalle?.code === "number" ? detalle.code : undefined

  switch (codigo) {
    case 131047:
      return {
        codigo,
        mensaje:
          "Pasaron más de 24 horas desde el último mensaje del paciente. WhatsApp no permite enviar archivos hasta que el paciente vuelva a escribir.",
      }
    case 131052:
      return { codigo, mensaje: "WhatsApp rechazó el archivo por tamaño. Probá con uno más liviano." }
    case 131053:
      return {
        codigo,
        mensaje:
          "WhatsApp rechazó el formato del archivo. Verificá que la extensión coincida con el contenido real (un PDF tiene que llamarse .pdf).",
      }
    case 131026:
      return { codigo, mensaje: "El número del paciente no puede recibir mensajes de WhatsApp." }
    case 190:
      return { codigo, mensaje: "Las credenciales de WhatsApp de esta clínica vencieron. Hay que renovarlas." }
    case 131056:
      return { codigo, mensaje: "WhatsApp está limitando los envíos a este número. Esperá un momento y reintentá." }
    default:
      break
  }

  const mensajeMeta = detalle?.error_user_msg || detalle?.message
  return {
    codigo,
    mensaje: mensajeMeta ? `WhatsApp rechazó el envío: ${mensajeMeta}` : "WhatsApp rechazó el envío del archivo.",
  }
}

/**
 * Igual que `interpretarErrorDeWhatsApp`, pero para los errores que lanzan las
 * funciones de lib/whatsapp-api.ts, que envuelven la respuesta de Meta dentro
 * del texto de un Error ("WhatsApp API error: {...}").
 *
 * Existe para que el envío de texto del panel dé el mismo mensaje claro que el
 * de archivos: hasta ahora, con la ventana cerrada, el agente veía el JSON de
 * Meta en un alert y reintentaba pensando que había fallado la red.
 */
export function interpretarErrorCrudo(error: unknown): { mensaje: string; codigo?: number } {
  const texto = error instanceof Error ? error.message : String(error ?? "")
  const desde = texto.indexOf("{")
  if (desde >= 0) {
    try {
      return interpretarErrorDeWhatsApp(JSON.parse(texto.slice(desde)))
    } catch {
      // Cae al genérico de abajo.
    }
  }
  return { mensaje: texto || "No se pudo enviar el mensaje." }
}

/**
 * Arma el `Content-Disposition` con un nombre de archivo que puede tener
 * acentos, eñes o caracteres raros.
 *
 * Las cabeceras HTTP solo admiten Latin-1. Un nombre con cualquier carácter
 * fuera de ese rango hace que la construcción de la respuesta lance
 * `TypeError: Cannot convert argument to a ByteString` y la ruta devuelva 500
 * con el archivo ya descargado — que es exactamente lo que pasó en producción
 * el 15/9/2026 con una captura de pantalla de macOS: el nombre traía U+202F
 * (espacio fino) antes del "p. m.".
 *
 * La solución es la de RFC 6266: un `filename` ASCII como respaldo para
 * clientes viejos, y un `filename*` codificado en UTF-8 que los navegadores
 * actuales prefieren y muestran con el nombre real.
 */
export function cabeceraContentDisposition(
  nombreArchivo: string,
  disposicion: "inline" | "attachment" = "inline",
): string {
  // Respaldo: solo ASCII imprimible, sin comillas ni barras que rompan el header.
  const ascii = (nombreArchivo || "")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_")
    .trim()
  const respaldo = ascii.length > 0 ? ascii : "archivo"

  // RFC 5987 no admite ' ( ) * , que encodeURIComponent deja sin escapar.
  const utf8 = encodeURIComponent(nombreArchivo || "archivo").replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  )

  return `${disposicion}; filename="${respaldo}"; filename*=UTF-8''${utf8}`
}

/** Error con el mensaje ya traducido, para que la ruta no tenga que interpretarlo. */
export class ErrorDeWhatsApp extends Error {
  codigo?: number
  constructor(mensaje: string, codigo?: number) {
    super(mensaje)
    this.name = "ErrorDeWhatsApp"
    this.codigo = codigo
  }
}

/**
 * Paso 1: sube el archivo y devuelve el media_id.
 * El id sirve para enviar el archivo tantas veces como haga falta durante 30 días.
 */
export async function uploadWhatsAppMedia(
  phoneNumberId: string,
  accessToken: string,
  archivo: Buffer,
  mimeType: string,
  nombreArchivo: string,
): Promise<string> {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/media`

  const form = new FormData()
  form.append("messaging_product", "whatsapp")
  form.append("type", mimeType)
  // Uint8Array en lugar del Buffer directo: Blob no acepta Buffer en todos los
  // runtimes de Node y el archivo llegaría vacío sin dar error.
  form.append("file", new Blob([new Uint8Array(archivo)], { type: mimeType }), nombreArchivo)

  console.log(
    `[WHATSAPP_MEDIA] ⬆️ Subiendo ${nombreArchivo} (${mimeType}, ${formatearTamano(archivo.length)}) a ${phoneNumberId}`,
  )

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  })

  const data = await response.json().catch(() => null)

  if (!response.ok || !data?.id) {
    console.error("[WHATSAPP_MEDIA] ❌ Error subiendo archivo:", JSON.stringify(data))
    const { mensaje, codigo } = interpretarErrorDeWhatsApp(data)
    throw new ErrorDeWhatsApp(mensaje, codigo)
  }

  console.log(`[WHATSAPP_MEDIA] ✅ Archivo subido, media_id: ${data.id}`)
  return data.id as string
}

/**
 * Paso 2: envía el archivo ya subido.
 *
 * El `caption` es el texto que acompaña a la imagen o al documento. WhatsApp lo
 * limita a 1024 caracteres; lo truncamos en vez de dejar que rechace el mensaje
 * entero y el paciente se quede sin el archivo.
 */
export async function sendWhatsAppMedia(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  opciones: { mediaId: string; tipo: TipoMedia; caption?: string; nombreArchivo?: string },
): Promise<any> {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`

  const MAX_CAPTION = 1024
  const caption = opciones.caption?.trim() ? opciones.caption.trim().slice(0, MAX_CAPTION) : undefined

  const contenido: Record<string, any> = { id: opciones.mediaId }
  if (caption) contenido.caption = caption
  // `filename` solo aplica a documentos; en imágenes WhatsApp lo ignora.
  if (opciones.tipo === "document" && opciones.nombreArchivo) {
    contenido.filename = opciones.nombreArchivo
  }

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizarTelefono(to),
    type: opciones.tipo,
    [opciones.tipo]: contenido,
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    console.error("[WHATSAPP_MEDIA] ❌ Error enviando archivo:", JSON.stringify(data))
    const { mensaje, codigo } = interpretarErrorDeWhatsApp(data)
    throw new ErrorDeWhatsApp(mensaje, codigo)
  }

  console.log(`[WHATSAPP_MEDIA] ✅ Archivo enviado a ${to} (${opciones.tipo})`)
  return data
}

/**
 * Trae el archivo desde WhatsApp para mostrarlo en el panel.
 *
 * Reusa `downloadWhatsAppMedia`, que ya resuelve los dos pasos (consultar el
 * media_id para obtener una URL, que dura 5 minutos, y después descargarla).
 * Devuelve null si el archivo ya no está — pasado el plazo de retención es lo
 * esperable, no una falla.
 */
export async function descargarMediaParaPanel(
  mediaId: string,
  accessToken: string,
): Promise<Buffer | null> {
  try {
    return await downloadWhatsAppMedia(mediaId, accessToken)
  } catch (error) {
    console.warn(`[WHATSAPP_MEDIA] No se pudo descargar ${mediaId}:`, error)
    return null
  }
}

/**
 * Misma normalización que lib/whatsapp-api.ts. Está duplicada a propósito para
 * no exportar desde ese módulo, que arrastra dependencias del flujo del bot.
 */
function normalizarTelefono(phone: string): string {
  const limpio = phone.replace(/[\s\-()+]/g, "")
  if (limpio.startsWith("549") && limpio.length >= 12) return limpio
  if (limpio.startsWith("54")) return "549" + limpio.substring(2)
  return "549" + limpio
}
