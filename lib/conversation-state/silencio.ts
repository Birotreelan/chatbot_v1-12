/**
 * Cuándo NO responder (29/9/2026).
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 *
 * Desde el 1/10 Meta cobra por mensaje enviado y no por conversación. Hasta
 * ahora el bot contestaba siempre: un "gracias!" costaba lo mismo que dar un
 * turno, y a un paciente que insiste tres veces con algo que no podemos hacer
 * le mandábamos la misma derivación tres veces.
 *
 * ── La decisión vive acá y no en cada rama ─────────────────────────────────
 *
 * Es el mismo criterio que `presentacion-inicial.ts`, y por la misma historia:
 * esa decisión estaba tomada a mano en trece lugares y cada rama nueva se
 * olvidaba. Callar tiene el agravante de que olvidarse no se ve — una rama que
 * responde de más pasa inadvertida hasta que alguien mira la factura.
 *
 * ── Las dos reglas, y la que deliberadamente NO está ───────────────────────
 *
 *  1. **Cierres conversacionales.** "Gracias", "chau", "perfecto". No se
 *     responde. La clasificación la hace el dispatcher, que ya distingue un
 *     agradecimiento suelto de uno con una pregunta pegada; acá sólo se decide
 *     qué hacer con esa clasificación. Un regex de /gracias|chau/ trataría
 *     igual a "gracias!!" y a "gracias, ¿y la dirección?".
 *
 *  2. **Una vez por ventana.** Los mensajes de "eso no lo podemos hacer por
 *     acá, comunicate con la clínica" se mandan una vez cada 24 h. El segundo
 *     no agrega información: el paciente ya sabe.
 *
 * Lo que NO está, a propósito: una regla de "no mandes dos veces seguidas el
 * mismo texto". Suena inofensiva y no lo es. El caso "no entendí tu respuesta,
 * elegí una opción" seguido del mismo menú es una repetición legítima y
 * necesaria; suprimirla deja al paciente mirando una pantalla que no cambia,
 * sin saber qué hizo mal. La repetición que molesta no es cualquiera: es la
 * del mensaje que no lleva a ningún lado, y ésa se marca a mano.
 *
 * ── Sólo en clientes del portal ────────────────────────────────────────────
 *
 * En esos clientes el paciente tiene el enlace y los botones: si el bot se
 * calla, le quedan caminos a la vista. En el resto, el chat es el único camino
 * y el silencio se lee como "no funciona".
 */

import { getRedisClient } from "../redis"

const PREFIJO = "silencio:"

/**
 * 24 horas: la misma ventana que la presentación como IA y que la de WhatsApp.
 * Un paciente que vuelve al día siguiente con lo mismo recibe la derivación de
 * nuevo, y está bien — puede haber pasado cualquier cosa en el medio.
 */
const VENTANA_SEGUNDOS = 24 * 60 * 60

export type MotivoDelSilencio = "cierre_conversacional" | "ya_se_dijo"

/**
 * ¿Este cliente usa el silencio?
 *
 * Se lee de la config ya cargada, no de Redis: el llamador siempre la tiene a
 * mano y agregar una lectura en el camino caliente del webhook por un booleano
 * no se paga.
 */
export function usaSilencio(config: { clientePortalWeb?: boolean } | null | undefined): boolean {
  return config?.clientePortalWeb === true
}

function clave(configId: string, phoneNumber: string, etiqueta: string): string {
  return `${PREFIJO}${configId}:${phoneNumber}:${etiqueta}`
}

/**
 * ¿Ya le dijimos esto en las últimas 24 h?
 *
 * `etiqueta` identifica QUÉ se dijo, no el texto exacto: si mañana se reescribe
 * la frase de derivación, el paciente no tiene que volver a recibirla por ser
 * otras palabras. Por eso la marca la pone el llamador y no se deduce de un
 * hash del mensaje.
 *
 * Ante un Redis caído devuelve `false` —o sea, se manda—. El error inofensivo
 * es un mensaje de más; callar por no poder leer el estado sería callar por
 * accidente, que es exactamente lo que no queremos.
 */
export async function yaSeDijo(
  configId: string,
  phoneNumber: string,
  etiqueta: string,
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false

  try {
    return (await redis.get(clave(configId, phoneNumber, etiqueta))) !== null
  } catch (error) {
    console.warn("[SILENCIO] No se pudo leer el estado; se envía igual:", error)
    return false
  }
}

/**
 * Anota que se dijo. Se llama DESPUÉS de que el mensaje salió de verdad: si se
 * anotara antes y el envío fallara, el paciente se quedaría sin la respuesta y
 * sin poder recibirla por 24 h.
 */
export async function anotarQueSeDijo(
  configId: string,
  phoneNumber: string,
  etiqueta: string,
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  try {
    await redis.setex(clave(configId, phoneNumber, etiqueta), VENTANA_SEGUNDOS, new Date().toISOString())
  } catch (error) {
    console.warn("[SILENCIO] No se pudo anotar el estado:", error)
  }
}

/**
 * Deja constancia de un mensaje que no se envió.
 *
 * No es decorativo. Un bot que responde de más se nota; uno que se calla de
 * más, no: no hay excepción, no hay log de error, y en el panel la
 * conversación se ve igual que una donde el paciente no volvió a escribir. Sin
 * esta línea, el día que una clasificación falle nos enteramos por un reclamo.
 *
 * Se registra el motivo y el principio del texto, que es lo que hace falta para
 * revisar después si lo que se calló había que callarlo.
 */
export function registrarSilencio(params: {
  configId: string
  phoneNumber: string
  motivo: MotivoDelSilencio
  texto?: string
  detalle?: string
}): void {
  const recorte = (params.texto || "").replace(/\s+/g, " ").trim().slice(0, 120)
  console.log(
    `[SILENCIO] No se respondió a ${params.phoneNumber} (${params.motivo}` +
      `${params.detalle ? `: ${params.detalle}` : ""})` +
      `${recorte ? ` — se iba a enviar: "${recorte}"` : ""}`,
  )
}
