/**
 * Pausa de RECORDATORIOS para un cliente (19/11/2026).
 *
 * ── Qué la distingue de la pausa total ─────────────────────────────────────
 *
 * `lib/pausa-de-envios.ts` corta todo: respuestas del bot, recordatorios,
 * confirmaciones del portal y lo que escriba un agente. Es la herramienta para
 * "dejá de consumir por completo", y cuando se usa, la clínica queda muda.
 *
 * Ésta corta una sola cosa: los recordatorios de turno que manda el sistema de
 * la clínica. El bot sigue contestando, el portal sigue funcionando y los
 * agentes siguen escribiendo. Sirve para el caso en que hay que frenar el
 * gasto grande —los recordatorios son el mayor volumen y lo que más pesa en la
 * factura— sin dejar sin atención a los pacientes que escriban.
 *
 * ── Los avisos críticos NO se pausan ───────────────────────────────────────
 *
 * Se ignoran `confirmacion_1_turno`, `confirmacion_2_turno` y
 * `confirmacion_3_turno`, y nada más. Siguen saliendo:
 *
 *   · `confirmar_turno_solicitado` — la clínica aprobó el turno que el
 *     paciente pidió. Si no sale, esa persona nunca se entera de que lo tiene.
 *   · `cancelar_turno_solicitado` — la clínica canceló. Si no sale, hay gente
 *     que se presenta a un turno que no existe.
 *   · `turno_reagendado` — cambió la fecha.
 *
 * Los dos primeros están marcados `critico: true` en el catálogo de
 * lib/integracion-externa/catalogo.ts, que es de donde sale esta lista. Un
 * recordatorio que no llega hace que alguien falte a un turno; un aviso de
 * cancelación que no llega hace que alguien viaje al pedo a una clínica.
 *
 * ── Por qué Redis y no un campo de la config ──────────────────────────────
 *
 * Mismo motivo que la pausa total: es estado operativo, se prende y se apaga
 * seguido, y guardarlo en la config obliga a reescribir el objeto entero y a
 * invalidar su caché en cada cambio. Y mismo criterio de llave: el `configId`,
 * que es lo que tiene en la mano quien manda el recordatorio.
 *
 * ── Sin vencimiento, y por eso tiene que verse ────────────────────────────
 *
 * Dura hasta que alguien la levante. Una clínica cuyos recordatorios están
 * pausados y nadie lo recuerda es una clínica que deja de avisar turnos
 * durante semanas, así que el dashboard lo muestra como un cartel y no como un
 * detalle.
 */

import { getRedisClient } from "./redis"

const PREFIJO = "recordatorios:pausa:"

/** Las tres familias que se ignoran. El resto del catálogo sigue saliendo. */
const PLANTILLAS_DE_RECORDATORIO = [
  "confirmacion_1_turno",
  "confirmacion_2_turno",
  "confirmacion_3_turno",
]

export interface EstadoDeRecordatorios {
  pausado: boolean
  desde?: string
  por?: string
  motivo?: string
}

function clave(configId: string): string {
  return `${PREFIJO}${configId}`
}

/**
 * ¿Este template es un recordatorio de turno?
 *
 * Por el nombre de la plantilla, que es lo que manda el sistema de la clínica
 * en el `Body`. Se compara por prefijo para tolerar las variantes con botones
 * —`confirmacion_1_turno_flows`, por ejemplo— que son el mismo recordatorio
 * con otra plantilla aprobada.
 */
export function esRecordatorioDeTurno(nombreDePlantilla?: string | null): boolean {
  const nombre = String(nombreDePlantilla || "").trim().toLowerCase()
  if (!nombre) return false
  return PLANTILLAS_DE_RECORDATORIO.some((p) => nombre.startsWith(p))
}

/**
 * Caché corta, igual que la pausa total: un envío no puede pagar una lectura
 * de más, y que la pausa tarde tres segundos en aplicarse es irrelevante.
 */
const CACHE_MS = 3000
const cache = new Map<string, { valor: boolean; hasta: number }>()

/**
 * ¿Están pausados los recordatorios de este cliente?
 *
 * Ante un fallo devuelve `false` —o sea, SE ENVÍA—. Es el mismo criterio
 * incómodo que la pausa total: equivocarse para el lado de enviar le cuesta
 * plata al cliente y es reembolsable; equivocarse para el otro lado deja a los
 * pacientes de una clínica médica sin el aviso de su turno por un problema de
 * infraestructura nuestro.
 */
export async function recordatoriosPausados(configId?: string | null): Promise<boolean> {
  if (!configId) return false

  const enCache = cache.get(configId)
  if (enCache && enCache.hasta > Date.now()) return enCache.valor

  const redis = getRedisClient()
  if (!redis) return false

  try {
    const crudo = await redis.get(clave(configId))
    const pausado = crudo !== null && crudo !== undefined
    cache.set(configId, { valor: pausado, hasta: Date.now() + CACHE_MS })
    return pausado
  } catch (error) {
    console.error("[RECORDATORIOS] No se pudo leer el estado de pausa:", error)
    return false
  }
}

/** El estado completo, para mostrarlo en el dashboard. */
export async function estadoDeRecordatorios(configId: string): Promise<EstadoDeRecordatorios> {
  const redis = getRedisClient()
  if (!redis) return { pausado: false }

  try {
    const crudo = await redis.get(clave(configId))
    if (!crudo) return { pausado: false }
    const datos = typeof crudo === "string" ? JSON.parse(crudo) : (crudo as any)
    return { pausado: true, desde: datos?.desde, por: datos?.por, motivo: datos?.motivo }
  } catch {
    return { pausado: false }
  }
}

export async function pausarRecordatorios(
  configId: string,
  datos?: { por?: string; motivo?: string },
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false

  try {
    // Sin TTL: dura hasta que alguien la levante. Ver la nota del encabezado.
    await redis.set(
      clave(configId),
      JSON.stringify({ desde: new Date().toISOString(), por: datos?.por, motivo: datos?.motivo }),
    )
    cache.delete(configId)
    console.log(`[RECORDATORIOS] ⏸️ Pausados para ${configId} por ${datos?.por || "—"}`)
    return true
  } catch (error) {
    console.error("[RECORDATORIOS] No se pudo pausar:", error)
    return false
  }
}

export async function reanudarRecordatorios(configId: string, por?: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false

  try {
    await redis.del(clave(configId))
    cache.delete(configId)
    console.log(`[RECORDATORIOS] ▶️ Reanudados para ${configId} por ${por || "—"}`)
    return true
  } catch (error) {
    console.error("[RECORDATORIOS] No se pudo reanudar:", error)
    return false
  }
}

/**
 * Lo que se le contesta al sistema de la clínica cuando el recordatorio se
 * ignora.
 *
 * `success: true` a propósito: para ese sistema el pedido se procesó y no hay
 * nada que reintentar. Devolver un error lo dejaría reintentando en loop —o
 * marcando el turno como "falló el aviso"— por una decisión nuestra que no es
 * una falla. El marcador `recordatorio_pausado` queda para que se pueda
 * distinguir en sus logs y en los nuestros.
 */
export function respuestaDeRecordatorioPausado(configId: string, plantilla?: string) {
  return {
    success: true,
    recordatorio_pausado: true,
    enviado: false,
    message: "Los recordatorios de este cliente están pausados desde el panel. El mensaje no se envió.",
    configId,
    plantilla: plantilla || undefined,
  }
}
