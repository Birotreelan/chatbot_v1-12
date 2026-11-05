/**
 * El enlace al chat de atención: una llave temporal a algo durable
 * (5/11/2026).
 *
 * ── Por qué un token propio y no el del portal ─────────────────────────────
 *
 * El del portal (lib/portal/token.ts) carga con todo lo que necesita una
 * gestión de turnos: la intención, el turno sobre el que se actúa, la
 * identidad resuelta, los filtros, los vencimientos que dependen de si el
 * enlace salió de un recordatorio o de una conversación. Nada de eso aplica
 * acá, y `IntencionDelPortal` es un union exhaustivo —hay `Record<Intencion,
 * …>` en varios lados— así que agregarle un valor obligaría a inventar una
 * plantilla de mensaje, un texto de botón y una rama en `decidirPaso` para un
 * flujo que no tiene pasos.
 *
 * Esto es mucho más chico: quién es, de qué clínica, y hasta cuándo vale.
 *
 * ── Por qué vence, si la conversación es para siempre ──────────────────────
 *
 * Son dos cosas distintas y conviene no confundirlas. La CONVERSACIÓN es
 * durable y vive indexada por cliente + teléfono. El TOKEN es la llave con la
 * que se entra a verla, y se reemite en cada notificación.
 *
 * Si el enlace no venciera, cada mensaje de WhatsApp que mandamos quedaría
 * siendo una llave permanente a la historia clínica de esa persona: cualquiera
 * que vea esa pantalla —o el log donde la URL quedó escrita— entra para
 * siempre, y no hay forma de revocarla. Es el mismo razonamiento que está
 * escrito en lib/sso.ts sobre por qué los tokens de SSO no son eternos.
 *
 * Treinta días es largo para una llave y corto para un descuido. Y como se
 * reemite en cada aviso, en la práctica el paciente siempre tiene uno vigente
 * mientras la clínica le esté escribiendo.
 */

import { randomBytes } from "crypto"
import { getRedisClient } from "../redis"

const PREFIJO = "atencion:token:"

/** Treinta días. Ver la nota de arriba. */
export const VIGENCIA_SEGUNDOS = 30 * 24 * 60 * 60

export interface EnlaceDeAtencion {
  configId: string
  clienteId: string
  /** Normalizado, el mismo con el que se indexa la conversación. */
  telefono: string
  /** Para saludar, si lo sabemos. */
  pacienteNombre?: string
  emitidoEl: string
}

/**
 * Un token nuevo.
 *
 * 24 bytes en base64url: 192 bits de entropía, el mismo orden que usa el
 * portal. No es adivinable y no dice nada de quién es.
 */
function nuevoToken(): string {
  return randomBytes(24).toString("base64url")
}

/**
 * Emite un enlace para este paciente y devuelve el token.
 *
 * Se emite uno nuevo por cada aviso en lugar de reusar el anterior. Cuesta lo
 * mismo y acota el daño de una URL filtrada a treinta días desde el último
 * aviso, en vez de desde el primero.
 */
export async function emitirEnlaceDeAtencion(datos: Omit<EnlaceDeAtencion, "emitidoEl">): Promise<string | null> {
  const redis = getRedisClient()
  if (!redis || !datos.clienteId || !datos.telefono) return null

  const token = nuevoToken()
  const enlace: EnlaceDeAtencion = { ...datos, emitidoEl: new Date().toISOString() }

  try {
    await redis.set(`${PREFIJO}${token}`, JSON.stringify(enlace), { ex: VIGENCIA_SEGUNDOS })
    return token
  } catch (error) {
    console.error("[ATENCION] No se pudo emitir el enlace:", error)
    return null
  }
}

/** Lee el enlace, o `null` si venció o nunca existió. */
export async function leerEnlaceDeAtencion(token: string): Promise<EnlaceDeAtencion | null> {
  const redis = getRedisClient()
  if (!redis || !token) return null

  try {
    const crudo = await redis.get(`${PREFIJO}${token}`)
    if (!crudo) return null
    const datos = typeof crudo === "string" ? JSON.parse(crudo) : crudo
    return datos?.telefono ? (datos as EnlaceDeAtencion) : null
  } catch (error) {
    console.error("[ATENCION] No se pudo leer el enlace:", error)
    return null
  }
}

/**
 * La URL del chat.
 *
 * `/a/` y no `/p/` ni `/c/`: son tres cosas distintas —gestión de turnos por
 * pantallas, el bot en formato chat, y esto— y compartir prefijo haría que un
 * token de una sirva para probar suerte en las otras.
 */
export function urlDelChat(token: string, baseUrl?: string): string {
  const base = baseUrl
    ? baseUrl.replace(/\/+$/, "")
    : process.env.APP_URL
      ? process.env.APP_URL.replace(/\/+$/, "")
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : ""
  return `${base}/a/${token}`
}
