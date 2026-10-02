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

export type MotivoDelSilencio = "cierre_conversacional" | "ya_se_dijo" | "respuesta_identica"

/**
 * Cuánto dura la memoria de "lo último que le dijimos" (2/10/2026).
 *
 * Una hora, y no las 24 h del resto del módulo, a propósito. Lo que justifica
 * callar es que el paciente TODAVÍA TIENE el mensaje a la vista: en una ráfaga
 * de tres mensajes seguidos eso es cierto; al día siguiente, no. Alguien que
 * vuelve a la tarde y recibe silencio porque a la mañana le dijimos lo mismo
 * creería que el servicio se cayó.
 */
const MEMORIA_DE_LA_ULTIMA_SEGUNDOS = 60 * 60

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

/**
 * ── La repetición consecutiva (2/10/2026) ──────────────────────────────────
 *
 * Reportado: un paciente escribió cuatro veces —"Buen día necesito turno",
 * "Magaly Alvarez", "DNI 92071137", "Por PAMI"— y recibió CUATRO veces el
 * mismo saludo de bienvenida, palabra por palabra, en un minuto. Se pagaron
 * cuatro mensajes para decir una sola cosa.
 *
 * Esto es la regla que el encabezado de este archivo dice que deliberadamente
 * NO está, y vale la pena explicar por qué ahora sí y en qué se diferencia.
 *
 * Lo que NO se implementa sigue sin implementarse: "no mandes dos veces el
 * mismo texto EN LA VENTANA". Eso rompería el caso legítimo —"no entendí tu
 * respuesta" seguido del mismo menú— que hay que mandar.
 *
 * Lo que sí se implementa es más angosto: no mandar un texto IDÉNTICO al
 * ÚLTIMO que se envió, sin nada en el medio. En el caso legítimo no aplica,
 * porque "no entendí…" + el menú no es idéntico al menú solo: el texto
 * cambió, así que sale. Acá el texto no cambió en absoluto, y un mensaje que
 * no cambió en nada no le dice al paciente nada que no esté leyendo ya.
 *
 * Importante: esto NO arregla la causa. Si el bot repite el mismo saludo es
 * porque el flujo no avanzó, y eso hay que mirarlo aparte. Lo que hace es
 * dejar de pagar por el síntoma y —gracias a `registrarSilencio`— dejarlo
 * anotado en los logs en vez de escondido.
 */
function claveDeLaUltima(configId: string, phoneNumber: string): string {
  return `${PREFIJO}ultima:${configId}:${phoneNumber}`
}

/** Normaliza para comparar: el mismo texto con otro espaciado es el mismo. */
function huella(mensaje: string): string {
  return mensaje.replace(/\s+/g, " ").trim()
}

/** ¿Es idéntico a lo último que le mandamos? */
export async function esIdenticoALoUltimo(
  configId: string,
  phoneNumber: string,
  mensaje: string,
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis || !mensaje) return false

  try {
    const anterior = await redis.get<string>(claveDeLaUltima(configId, phoneNumber))
    return typeof anterior === "string" && anterior === huella(mensaje)
  } catch (error) {
    console.warn("[SILENCIO] No se pudo leer la última respuesta; se envía igual:", error)
    return false
  }
}

/** Recuerda lo último enviado. Se llama DESPUÉS de que el mensaje salió. */
export async function recordarUltimaRespuesta(
  configId: string,
  phoneNumber: string,
  mensaje: string,
): Promise<void> {
  const redis = getRedisClient()
  if (!redis || !mensaje) return

  try {
    await redis.setex(
      claveDeLaUltima(configId, phoneNumber),
      MEMORIA_DE_LA_ULTIMA_SEGUNDOS,
      huella(mensaje),
    )
  } catch (error) {
    console.warn("[SILENCIO] No se pudo recordar la última respuesta:", error)
  }
}
