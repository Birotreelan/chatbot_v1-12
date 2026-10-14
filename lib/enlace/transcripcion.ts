/**
 * La conversación del enlace, guardada (14/10/2026).
 *
 * ── Por qué esto SÍ se guarda ──────────────────────────────────────────────
 *
 * El portal no guarda transcripción: su estado vive en la query string y las
 * pantallas se derivan de ahí. Acá es al revés y la diferencia es real, no de
 * gusto: una conversación ES su historial. Si se perdiera al recargar, el
 * paciente volvería a una pantalla en blanco con un flujo a medio hacer del
 * otro lado —el estado del motor sigue vivo en Redis— y no tendría forma de
 * saber qué había contestado.
 *
 * Se guarda por TOKEN y no por teléfono. El mismo paciente puede tener una
 * conversación abierta en WhatsApp y otra en el enlace, y mezclarlas sería
 * mostrarle acá lo que dijo allá.
 *
 * ── Qué NO es ──────────────────────────────────────────────────────────────
 *
 * No es la fuente de verdad del flujo. Quién es el paciente, en qué paso está
 * y qué eligió lo sabe el motor conversacional, igual que en WhatsApp. Esto es
 * lo que se dibuja. Si las dos cosas discreparan, manda el motor.
 */

import { getRedisClient } from "../redis"

const PREFIJO = "enlace:chat:"

/**
 * Se guarda lo mismo que dura el enlace más un margen.
 *
 * El enlace de una conversación vive 30 minutos y el de un recordatorio hasta
 * dos días. Con 48 h se cubren los dos sin tener que leer la vigencia acá: una
 * transcripción que sobrevive a su enlace no molesta a nadie —no se puede
 * abrir— y una que muere antes deja al paciente mirando una pantalla vacía.
 */
const TTL_SEGUNDOS = 48 * 60 * 60

/** Cuántos mensajes se conservan. Ver la nota de `agregar`. */
const MAXIMO = 60

export interface MensajeDelChat {
  de: "asistente" | "paciente"
  texto: string
  /** ISO. Para ordenar y, si alguna vez hace falta, para mostrar la hora. */
  en: string
  /**
   * Botones que acompañaban a este mensaje del asistente.
   *
   * Se guardan junto al mensaje y no aparte porque pertenecen a él: al recargar
   * hay que poder volver a dibujar las opciones del último mensaje. Los de los
   * mensajes anteriores quedan guardados pero no se dibujan — ver el cliente.
   */
  botones?: Array<{ id: string; titulo: string; detalle?: string }>
}

function clave(token: string): string {
  return `${PREFIJO}${token}`
}

export async function leerTranscripcion(token: string): Promise<MensajeDelChat[]> {
  const redis = getRedisClient()
  if (!redis || !token) return []

  try {
    const crudo = await redis.get(clave(token))
    if (!crudo) return []
    // Upstash deserializa solo lo que parece JSON, así que puede venir de las
    // dos formas. Ya nos costó un diagnóstico entero no contemplarlo.
    const datos = typeof crudo === "string" ? JSON.parse(crudo) : (crudo as unknown)
    return Array.isArray(datos) ? (datos as MensajeDelChat[]) : []
  } catch (error) {
    console.warn("[ENLACE] No se pudo leer la transcripción:", error)
    return []
  }
}

/**
 * Agrega mensajes al final.
 *
 * Se recorta a los últimos `MAXIMO`: una conversación de turnos no pasa de
 * quince intercambios, así que el tope sólo actúa si algo se va de control —un
 * bucle, alguien tocando el mismo botón cincuenta veces— y ahí lo que importa
 * es que la clave de Redis no crezca sin límite.
 *
 * Nunca lanza. Perder una transcripción es feo; cortar la conversación del
 * paciente porque no se pudo guardar lo que ya se le mostró, peor.
 */
export async function agregarALaTranscripcion(
  token: string,
  nuevos: MensajeDelChat[],
): Promise<MensajeDelChat[]> {
  const previos = await leerTranscripcion(token)
  const todos = [...previos, ...nuevos].slice(-MAXIMO)

  const redis = getRedisClient()
  if (!redis || !token) return todos

  try {
    await redis.set(clave(token), JSON.stringify(todos), { ex: TTL_SEGUNDOS })
  } catch (error) {
    console.warn("[ENLACE] No se pudo guardar la transcripción:", error)
  }

  return todos
}

/** Un mensaje, con la hora puesta acá para no repetir `new Date()` en cada llamador. */
export function mensaje(
  de: MensajeDelChat["de"],
  texto: string,
  botones?: MensajeDelChat["botones"],
): MensajeDelChat {
  return { de, texto, en: new Date().toISOString(), ...(botones?.length ? { botones } : {}) }
}
