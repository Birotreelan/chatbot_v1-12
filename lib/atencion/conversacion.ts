/**
 * La conversación de atención humana, durable (5/11/2026).
 *
 * ── Por qué existe un store nuevo ──────────────────────────────────────────
 *
 * Porque todo lo que hay hoy dura siete días:
 *
 *   lib/conversations.ts      CONVERSATION_TTL     = 7 días
 *   lib/human-support.ts      RESOLVED_SESSION_TTL = 7 días
 *   app/api/cron/cleanup      CLEANUP_CONVERSATION_DAYS = 7
 *
 * Y el pedido es que un paciente que chatea hoy, si vuelve a chatear en dos
 * meses, vea la conversación de hoy. Como WhatsApp. Eso no se consigue
 * subiéndole el TTL a lo que ya hay: esos TTL existen por una razón —el
 * historial de la conversación con el BOT crece sin techo y casi nunca se
 * mira—, y tocarlos cambiaría el costo de Redis de todo el proyecto.
 *
 * Esto es otra cosa: lo que una persona le escribió a otra. Es poco volumen,
 * se consulta, y tiene valor meses después.
 *
 * ── Indexada por cliente + teléfono, NO por sesión ni por token ────────────
 *
 * Es la decisión que hace que el requisito se cumpla. Una sesión de soporte
 * dura lo que dura la consulta; el token del chat se reemite cada vez. La
 * conversación sobrevive a los dos, igual que un chat de WhatsApp sobrevive a
 * cada vez que lo abrís.
 *
 * Y tiene una consecuencia de seguridad que conviene decir: el token es una
 * llave TEMPORAL a una conversación durable. Si el enlace no venciera, cada
 * mensaje de WhatsApp que mandamos quedaría siendo una llave eterna a la
 * historia de esa persona, sin forma de revocarla. Ver lib/atencion/token.ts.
 *
 * ── Un tope, dicho ────────────────────────────────────────────────────────
 *
 * `MAXIMO_MENSAJES` recorta los más viejos. Sin tope esto crece para siempre y
 * un día alguien descubre una clave de 40 MB. Con tope hay que elegir un
 * número y decir que se pierde lo anterior, que es lo honesto.
 */

import { getRedisClient } from "../redis"
import type { MediaAdjunta } from "../types"

const PREFIJO = "atencion:conv:"

/**
 * Cuántos mensajes se guardan por conversación.
 *
 * Mil es mucho más de lo que dura una consulta de clínica y poco para Redis
 * (un mensaje de texto son ~200 bytes). Al llegar al tope se pierden los más
 * viejos, no los nuevos: lo que se mira es lo último.
 */
export const MAXIMO_MENSAJES = 1000

export type RolEnLaConversacion = "paciente" | "agente" | "sistema"

export interface MensajeDeAtencion {
  id: string
  rol: RolEnLaConversacion
  /** El texto. Vacío cuando el mensaje es sólo un archivo. */
  texto: string
  /** ISO. */
  enviadoEl: string
  /** Quién contestó, para mostrarlo del lado del paciente. */
  agenteNombre?: string
  /**
   * Por dónde llegó o salió.
   *
   * Importa para el historial: dos meses después, saber si algo se dijo por
   * WhatsApp o por el chat explica por qué el mensaje es corto o por qué hay
   * un salto de una hora.
   */
  via?: "chat" | "whatsapp"
  media?: MediaAdjunta
  /** La sesión de soporte en la que ocurrió, si la hubo. */
  sessionId?: string
}

function clave(clienteId: string, telefono: string): string {
  return `${PREFIJO}${clienteId}:${telefono}`
}

/**
 * Agrega un mensaje y devuelve el que quedó guardado.
 *
 * No falla hacia afuera: si Redis no está, el mensaje igual se mostró en el
 * panel y se envió. Perder una línea del historial es malo; que un agente no
 * pueda contestar porque el historial no se pudo escribir es peor.
 */
export async function agregarMensaje(
  clienteId: string,
  telefono: string,
  mensaje: MensajeDeAtencion,
): Promise<void> {
  const redis = getRedisClient()
  if (!redis || !clienteId || !telefono) return

  try {
    const k = clave(clienteId, telefono)
    await redis.rpush(k, JSON.stringify(mensaje))
    // Sin TTL: es el punto de todo esto. El tope lo pone la longitud.
    await redis.ltrim(k, -MAXIMO_MENSAJES, -1)
  } catch (error) {
    console.error("[ATENCION] No se pudo guardar el mensaje en la conversación:", error)
  }
}

/**
 * La conversación completa, del más viejo al más nuevo.
 *
 * `desde` permite pedir sólo lo nuevo: el chat consulta cada pocos segundos y
 * traer mil mensajes cada vez sería absurdo.
 */
export async function leerConversacion(
  clienteId: string,
  telefono: string,
  opciones?: { ultimos?: number },
): Promise<MensajeDeAtencion[]> {
  const redis = getRedisClient()
  if (!redis || !clienteId || !telefono) return []

  try {
    const desde = opciones?.ultimos ? -opciones.ultimos : 0
    const crudos = (await redis.lrange(clave(clienteId, telefono), desde, -1)) || []
    const mensajes: MensajeDeAtencion[] = []
    for (const crudo of crudos) {
      try {
        // Upstash deserializa solo lo que parece JSON: puede venir objeto.
        const m = typeof crudo === "string" ? JSON.parse(crudo) : crudo
        if (m?.id) mensajes.push(m as MensajeDeAtencion)
      } catch {
        // Una línea ilegible no puede romper el historial entero.
      }
    }
    return mensajes
  } catch (error) {
    console.error("[ATENCION] No se pudo leer la conversación:", error)
    return []
  }
}

/** Cuántos mensajes tiene. Para decidir si hay historial que mostrar. */
export async function contarMensajes(clienteId: string, telefono: string): Promise<number> {
  const redis = getRedisClient()
  if (!redis || !clienteId || !telefono) return 0
  try {
    return (await redis.llen(clave(clienteId, telefono))) || 0
  } catch {
    return 0
  }
}

// ── Presencia: ¿el paciente está mirando el chat? ───────────────────────────

const PRESENCIA = "atencion:presencia:"

/**
 * Cuánto dura un latido.
 *
 * El chat consulta cada 5 segundos mientras está abierto, así que 40 s cubre
 * varios fallos de red seguidos sin dar por ausente a alguien que está ahí.
 * Y es corto: dar por presente a quien cerró la pestaña hace un minuto
 * significa no notificarle una respuesta que no va a ver.
 */
export const PRESENCIA_SEGUNDOS = 40

/** El chat avisa que sigue abierto. */
export async function marcarPresente(clienteId: string, telefono: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  try {
    await redis.set(`${PRESENCIA}${clienteId}:${telefono}`, Date.now(), { ex: PRESENCIA_SEGUNDOS })
  } catch {
    // Si no se puede marcar, se lo tratará como ausente: se le notifica de
    // más. Es el lado seguro del error.
  }
}

/** `true` si el paciente tuvo el chat abierto hace menos de PRESENCIA_SEGUNDOS. */
export async function estaPresente(clienteId: string, telefono: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false
  try {
    return (await redis.get(`${PRESENCIA}${clienteId}:${telefono}`)) !== null
  } catch {
    return false
  }
}
