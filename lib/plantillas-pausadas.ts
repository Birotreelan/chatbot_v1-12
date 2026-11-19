/**
 * Plantillas pausadas, una por una, por cliente (19/11/2026).
 *
 * ── Qué resuelve ──────────────────────────────────────────────────────────
 *
 * Cuando el sistema de la clínica manda un template, acá se decide si sale o
 * se ignora. La decisión es por plantilla y por cliente: se puede frenar
 * `confirmacion_1_turno` de una clínica y dejar todo lo demás andando.
 *
 * ── Por qué reemplazó a la pausa de recordatorios ─────────────────────────
 *
 * El primer intento (18/11) era un switch por cliente que ignoraba las tres
 * familias de recordatorio, con la lista escrita en el código. Dos problemas:
 * la lista hay que acordarse de actualizarla cuando aparece una plantilla
 * nueva, y la categoría la elegía yo —un día alguien quiere frenar la
 * encuesta postoperatoria y la categoría no la contempla—.
 *
 * Acá no hay categorías. La unidad es la plantilla, que es lo que la clínica
 * ve en su panel de WhatsApp y lo que viene en el `Body` del recordatorio.
 *
 * ── Una clave por cliente, no una por plantilla ───────────────────────────
 *
 * Un cliente puede tener veinte plantillas, y preguntar "¿está pausada ésta?"
 * con una lectura por envío es barato; con una lectura por plantilla sería
 * veinte veces lo mismo. Se guarda un objeto con las pausadas, se lee entero y
 * se consulta en memoria.
 *
 * ── Qué NO decide este módulo ─────────────────────────────────────────────
 *
 * Si una plantilla conviene pausarse o no. Hay avisos que, pausados, hacen que
 * un paciente se presente a un turno que no existe —`cancelar_turno_solicitado`
 * es el ejemplo— y el dashboard lo advierte antes de que alguien lo toque. Pero
 * la decisión es de quien opera: inventar una lista de plantillas
 * "imposibles de pausar" sería adivinar en qué situación está la clínica.
 */

import { getRedisClient } from "./redis"

const PREFIJO = "plantillas:pausadas:"

export interface PlantillaPausada {
  desde: string
  por?: string
}

/** nombre de plantilla → cuándo y quién la pausó. */
export type PlantillasPausadas = Record<string, PlantillaPausada>

function clave(configId: string): string {
  return `${PREFIJO}${configId}`
}

/** El nombre de la plantilla, normalizado: Meta los da en minúscula. */
function normalizar(nombre?: string | null): string {
  return String(nombre || "").trim().toLowerCase()
}

/**
 * Caché corta, igual que las otras compuertas del proyecto.
 *
 * Un solo recordatorio no puede pagar una lectura de más, y que la pausa tarde
 * tres segundos en aplicarse es irrelevante frente a que tarde minutos.
 */
const CACHE_MS = 3000
const cache = new Map<string, { valor: PlantillasPausadas; hasta: number }>()

export async function plantillasPausadas(configId?: string | null): Promise<PlantillasPausadas> {
  if (!configId) return {}

  const enCache = cache.get(configId)
  if (enCache && enCache.hasta > Date.now()) return enCache.valor

  const redis = getRedisClient()
  if (!redis) return {}

  try {
    const crudo = await redis.get(clave(configId))
    const valor: PlantillasPausadas = crudo
      ? (typeof crudo === "string" ? JSON.parse(crudo) : (crudo as any)) || {}
      : {}
    cache.set(configId, { valor, hasta: Date.now() + CACHE_MS })
    return valor
  } catch (error) {
    console.error("[PLANTILLAS] No se pudo leer el estado de pausa:", error)
    return {}
  }
}

/**
 * ¿Esta plantilla de este cliente está pausada?
 *
 * Ante un fallo devuelve `false` —o sea, SE ENVÍA—. Mismo criterio incómodo
 * que la pausa total de envíos: equivocarse para el lado de enviar le cuesta
 * plata al cliente y es reembolsable; equivocarse para el otro deja a los
 * pacientes de una clínica médica sin el aviso de su turno por un problema de
 * infraestructura nuestro.
 */
export async function plantillaPausada(
  configId?: string | null,
  nombreDePlantilla?: string | null,
): Promise<boolean> {
  const nombre = normalizar(nombreDePlantilla)
  if (!configId || !nombre) return false
  const pausadas = await plantillasPausadas(configId)
  return Boolean(pausadas[nombre])
}

export async function pausarPlantilla(
  configId: string,
  nombreDePlantilla: string,
  por?: string,
): Promise<boolean> {
  const nombre = normalizar(nombreDePlantilla)
  if (!configId || !nombre) return false

  const redis = getRedisClient()
  if (!redis) return false

  try {
    const pausadas = await plantillasPausadas(configId)
    pausadas[nombre] = { desde: new Date().toISOString(), por }
    // Sin TTL: dura hasta que alguien la levante, y por eso el panel la marca.
    await redis.set(clave(configId), JSON.stringify(pausadas))
    cache.delete(configId)
    console.log(`[PLANTILLAS] ⏸️ ${nombre} pausada para ${configId} por ${por || "—"}`)
    return true
  } catch (error) {
    console.error("[PLANTILLAS] No se pudo pausar:", error)
    return false
  }
}

export async function reanudarPlantilla(
  configId: string,
  nombreDePlantilla: string,
  por?: string,
): Promise<boolean> {
  const nombre = normalizar(nombreDePlantilla)
  if (!configId || !nombre) return false

  const redis = getRedisClient()
  if (!redis) return false

  try {
    const pausadas = await plantillasPausadas(configId)
    delete pausadas[nombre]
    if (Object.keys(pausadas).length === 0) await redis.del(clave(configId))
    else await redis.set(clave(configId), JSON.stringify(pausadas))
    cache.delete(configId)
    console.log(`[PLANTILLAS] ▶️ ${nombre} reanudada para ${configId} por ${por || "—"}`)
    return true
  } catch (error) {
    console.error("[PLANTILLAS] No se pudo reanudar:", error)
    return false
  }
}

/**
 * Las que, pausadas, dejan a un paciente sin una información que necesita.
 *
 * No bloquean nada: el panel las marca para que quien toca el botón sepa lo
 * que pasa si las frena. Salen del catálogo de
 * lib/integracion-externa/catalogo.ts, donde las dos primeras están como
 * `critico: true`.
 */
export const PLANTILLAS_DELICADAS: Record<string, string> = {
  confirmar_turno_solicitado:
    "Es el aviso de que la clínica APROBÓ el turno que el paciente pidió. Pausada, esa persona nunca se entera de que tiene turno.",
  cancelar_turno_solicitado:
    "Es el aviso de que la clínica CANCELÓ el turno. Pausada, hay gente que se presenta a un turno que no existe.",
  turno_reagendado:
    "Avisa que el turno cambió de fecha u hora. Pausada, el paciente se presenta el día viejo.",
}

export function advertenciaDePlantilla(nombreDePlantilla?: string | null): string | undefined {
  return PLANTILLAS_DELICADAS[normalizar(nombreDePlantilla)]
}

/**
 * Lo que se le contesta al sistema de la clínica cuando el template se ignora.
 *
 * `success: true` a propósito: para ese sistema el pedido se procesó y no hay
 * nada que reintentar. Devolver un error lo dejaría reintentando en loop —o
 * marcando el turno como "falló el aviso"— por una decisión nuestra que no es
 * una falla. El marcador queda para distinguirlo en sus logs y en los nuestros.
 */
export function respuestaDePlantillaPausada(configId: string, plantilla: string) {
  return {
    success: true,
    plantilla_pausada: true,
    enviado: false,
    message: `La plantilla ${plantilla} está pausada desde el panel para este cliente. El mensaje no se envió.`,
    configId,
    plantilla,
  }
}
