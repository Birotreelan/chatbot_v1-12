/**
 * Pausa total de envíos de WhatsApp para un cliente (1/10/2026).
 *
 * ── Qué hace ───────────────────────────────────────────────────────────────
 *
 * Mientras está activa, NADA sale hacia Meta por ese número: ni respuestas del
 * bot, ni recordatorios, ni confirmaciones del portal, ni lo que escriba un
 * agente desde el panel de soporte. Sin excepciones, que fue el pedido:
 * "que se deje de consumir por completo los costos de WhatsApp".
 *
 * Recibir sigue funcionando igual. Los mensajes del paciente se guardan, se ven
 * en el monitor y suman a las estadísticas: Meta cobra lo que se manda, no lo
 * que entra, y conservarlo es lo que después permite ver qué pasó durante la
 * pausa.
 *
 * ── Por qué la llave es el phoneNumberId ───────────────────────────────────
 *
 * Porque es el único dato que los cuatro emisores de lib/whatsapp-api.ts ya
 * tienen en la mano. Con `configId` o `cliente_id` habría que resolver el
 * cliente en cada envío —una lectura más por mensaje, en el camino caliente—
 * y, peor, la compuerta dependería de que ese mapeo esté bien. Acá la pregunta
 * es directa: "¿este número está pausado?".
 *
 * Quien pausa habla de clientes, no de números; la traducción se hace una sola
 * vez, en el endpoint, que tiene tiempo de sobra para hacerla.
 *
 * ── Por qué Redis y no la config ───────────────────────────────────────────
 *
 * `WhatsAppConfig.paused` existe desde antes y nunca se leyó del lado del
 * servidor: el botón del dashboard lo escribía y el motor lo ignoraba. No se
 * reusa ese campo a propósito, para que no queden dos banderas que dicen lo
 * mismo y pueden contradecirse. Además esto es estado operativo —se prende y
 * se apaga seguido— y guardarlo en la config obliga a reescribir el objeto
 * entero y a invalidar su caché en cada cambio.
 *
 * ── Sin vencimiento ────────────────────────────────────────────────────────
 *
 * Decisión tomada: la pausa dura hasta que alguien la levante. Por eso la
 * clave NO lleva TTL, y por eso el dashboard tiene que mostrarla bien visible:
 * es la única defensa contra una clínica que queda muda sin que nadie lo note.
 */

import { getRedisClient } from "./redis"

const PREFIJO = "envios:pausa:"

export interface EstadoDePausa {
  pausado: boolean
  /** Cuándo se pausó. */
  desde?: string
  /** Quién la activó: "dashboard", "api", el usuario que la pidió. */
  por?: string
  motivo?: string
}

function clave(phoneNumberId: string): string {
  return `${PREFIJO}${phoneNumberId}`
}

/**
 * Caché en memoria, muy corta.
 *
 * Un solo webhook puede terminar enviando tres o cuatro mensajes (el texto, los
 * botones, el menú de vuelta), y cada uno preguntaría lo mismo. Dura segundos
 * porque la instancia vive poco y porque una pausa que tarda tres segundos en
 * aplicarse es irrelevante, mientras que una que tarda minutos sería un
 * incumplimiento de lo que el botón promete.
 */
const CACHE_MS = 3000
const cache = new Map<string, { valor: boolean; hasta: number }>()

/**
 * ¿Este número tiene los envíos pausados?
 *
 * Ante un fallo devuelve `false`, o sea que SE ENVÍA. Es deliberado y es la
 * decisión incómoda: equivocarse para el lado de enviar le cuesta dinero al
 * cliente, y equivocarse para el otro lado deja a pacientes de una clínica
 * médica sin respuesta por un problema de infraestructura nuestro. Entre
 * cobrar de más y callar de más en este contexto, se prefiere lo primero,
 * que además es reembolsable.
 */
export async function envíosPausados(phoneNumberId?: string | null): Promise<boolean> {
  if (!phoneNumberId) return false

  const enCache = cache.get(phoneNumberId)
  if (enCache && enCache.hasta > Date.now()) return enCache.valor

  const redis = getRedisClient()
  if (!redis) return false

  try {
    const crudo = await redis.get(clave(phoneNumberId))
    const pausado = crudo !== null && crudo !== undefined
    cache.set(phoneNumberId, { valor: pausado, hasta: Date.now() + CACHE_MS })
    return pausado
  } catch (error) {
    console.warn("[PAUSA_ENVIOS] No se pudo leer el estado; se envía igual:", error)
    return false
  }
}

/** El estado completo, para el dashboard y el endpoint de consulta. */
export async function estadoDePausa(phoneNumberId: string): Promise<EstadoDePausa> {
  const redis = getRedisClient()
  if (!redis) return { pausado: false }

  try {
    const crudo = await redis.get(clave(phoneNumberId))
    if (crudo === null || crudo === undefined) return { pausado: false }

    const datos = typeof crudo === "string" ? JSON.parse(crudo) : (crudo as any)
    return { pausado: true, desde: datos?.desde, por: datos?.por, motivo: datos?.motivo }
  } catch {
    // Si el contenido es ilegible, la clave existe y eso ya significa pausado.
    return { pausado: true }
  }
}

export async function pausarEnvios(
  phoneNumberId: string,
  datos: { por?: string; motivo?: string } = {},
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false

  await redis.set(
    clave(phoneNumberId),
    JSON.stringify({ desde: new Date().toISOString(), por: datos.por, motivo: datos.motivo }),
  )
  cache.delete(phoneNumberId)
  console.log(`[PAUSA_ENVIOS] ⏸️  ${phoneNumberId} pausado${datos.por ? ` por ${datos.por}` : ""}`)
  return true
}

export async function reanudarEnvios(phoneNumberId: string, por?: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false

  await redis.del(clave(phoneNumberId))
  cache.delete(phoneNumberId)
  console.log(`[PAUSA_ENVIOS] ▶️  ${phoneNumberId} reanudado${por ? ` por ${por}` : ""}`)
  return true
}

/**
 * Lo que devuelven los emisores cuando no mandan nada.
 *
 * Tiene forma de respuesta y no de excepción a propósito: los más de sesenta
 * llamadores siguen su curso —guardan el mensaje en la conversación, actualizan
 * el estado del flujo, contestan 200 al webhook— sin que haya que tocarlos uno
 * por uno. Lo único que no pasa es el gasto.
 *
 * `pausado: true` permite que un llamador que quiera enterarse pueda hacerlo;
 * el panel de soporte lo usa para avisarle al agente que su mensaje no salió.
 */
export function respuestaDeEnvioPausado(phoneNumberId: string, destino: string) {
  console.log(`[PAUSA_ENVIOS] 🚫 Envío omitido a ${destino} (número ${phoneNumberId} pausado)`)
  return { pausado: true, enviado: false, messages: [] as unknown[] }
}
