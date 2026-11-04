/**
 * Los conteos que muestra el widget de notificaciones, con su caché.
 *
 * ── Por qué salió del endpoint SSE (4/11/2026) ─────────────────────────────
 *
 * Porque ahora lo piden dos: el SSE de siempre y el endpoint JSON nuevo que
 * usa el widget con polling. Duplicar la caché habría sido duplicar también la
 * decisión de qué entra en el total — y esa decisión ya cambió una vez
 * (`esperando_count`, 20/10/2026), con una nota explicando por qué el total se
 * recalcula en vez de leerse de la entrada cacheada.
 *
 * Dos copias de eso significan que el badge del widget y el del panel pueden
 * contar distinto durante los 35 segundos de una ventana de caché, y nadie
 * entendería por qué.
 */

import { contarAvisosDelAgente, type ConteoDeAvisos } from "./human-support"
import { getRedisClient } from "./redis"

/**
 * TTL de la caché, en segundos.
 *
 * Tiene que ser MAYOR al intervalo con el que se pide (30 s): si fuera menor,
 * cada consulta encontraría la entrada vencida y recomputaría
 * `getPendingSessions` + `getAgentActiveSessions` desde cero. Ya pasó, con 20 s
 * contra un intervalo de 30 (fix 27/8/2026).
 */
export const CONTEOS_CACHE_TTL = 35

/**
 * El prefijo es el de siempre, `sse_counts:`, aunque ya no sea sólo del SSE.
 *
 * Renombrarlo dejaría a las dos versiones del endpoint —el SSE viejo y el JSON
 * nuevo— mirando claves distintas durante el deploy: los mismos conteos
 * calculados dos veces, y dos badges que no coinciden. El nombre viejo de una
 * clave es una deuda baratísima al lado de eso.
 */
const CONTEOS_CACHE_PREFIX = "sse_counts:"

export interface ConteoDelWidget extends ConteoDeAvisos {
  /** `true` si salió de la caché. Sólo para el log. */
  deLaCache: boolean
}

/**
 * Los conteos de este agente, de la caché o recalculados.
 *
 * La clave es por tenant Y por usuario: `active_count` es por agente, así que
 * compartirla sólo por tenant le serviría a todos el conteo del primer usuario
 * que consultó durante la ventana de caché.
 */
export async function conteoParaElWidget(
  tenantId: string,
  userId: string,
): Promise<ConteoDelWidget> {
  const redis = getRedisClient()
  const clave = `${CONTEOS_CACHE_PREFIX}${tenantId}:${userId}`

  const cacheado = redis ? await redis.get(clave).catch(() => null) : null
  if (cacheado) {
    const c = typeof cacheado === "string" ? JSON.parse(cacheado) : (cacheado as Partial<ConteoDeAvisos>)
    const pending_count = c.pending_count ?? 0
    const active_count = c.active_count ?? 0
    // `esperando_count` puede faltar en una entrada escrita por la versión
    // anterior (20/10/2026). El total se recalcula desde los dos campos en vez
    // de leer `c.total`, para no servir durante 35 segundos un total con el
    // criterio viejo después de un deploy.
    const esperando_count = c.esperando_count ?? 0
    return {
      pending_count,
      active_count,
      esperando_count,
      total: pending_count + esperando_count,
      deLaCache: true,
    }
  }

  const conteo = await contarAvisosDelAgente(tenantId, userId)
  if (redis) {
    redis.setex(clave, CONTEOS_CACHE_TTL, JSON.stringify(conteo)).catch(() => {})
  }
  return { ...conteo, deLaCache: false }
}
