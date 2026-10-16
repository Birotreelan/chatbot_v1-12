/**
 * El dólar con el que calcula la pestaña Servicio (16/10/2026).
 *
 * ── Por qué por MES y no uno solo ──────────────────────────────────────────
 *
 * Porque la tabla tiene un selector de período arriba y cada mes se mira con el
 * dólar de ese mes. Un único valor haría que fijar el de octubre cambiara
 * también lo que muestra noviembre, y el número de octubre dejaría de ser
 * reproducible — que es justo lo que se quiere al poder fijarlo.
 *
 * Es la diferencia con la observación, que sí es una sola por cliente: aquella
 * es una nota, esto entra en una multiplicación.
 *
 * ── Qué pasa si no hay nada guardado ───────────────────────────────────────
 *
 * Se usa el dólar vivo, el mismo que muestra Facturación. Devolver 0 o null
 * dejaría la columna de pesos en blanco hasta que alguien cargue el valor, y no
 * hay motivo: mientras nadie lo fije, el de hoy es la mejor respuesta.
 *
 * Hasta septiembre de 2026 esto no se usa: Servicio muestra el dólar que quedó
 * congelado en el cierre de Facturación. Ver lib/servicio-calculo.ts.
 */

import { Redis } from "@upstash/redis"

const DOLAR_PREFIX = "servicio:dolar:"

function getRedisClient() {
  try {
    return Redis.fromEnv()
  } catch (error) {
    console.error("[servicio-dolar] Error creando Redis client:", error)
    return null
  }
}

/** El dólar fijado para ese período, o `null` si nadie lo fijó. */
export async function getDolarServicio(periodo: string): Promise<number | null> {
  const redis = getRedisClient()
  if (!redis) return null

  const value = await redis.get<number | string>(`${DOLAR_PREFIX}${periodo}`)
  if (value === null || value === undefined) return null
  const num = typeof value === "string" ? parseFloat(value) : value
  return Number.isFinite(num) && num > 0 ? num : null
}

/**
 * Fija el dólar de un período. Con `null` o 0 se borra y se vuelve al vivo.
 *
 * Poder volver atrás importa: si alguien carga un valor equivocado, sin esto la
 * única salida sería escribir el "correcto", y el mes quedaría con un número
 * inventado en vez de con el del día.
 */
export async function setDolarServicio(periodo: string, valor: number | null): Promise<void> {
  const redis = getRedisClient()
  if (!redis) throw new Error("Redis no está disponible")

  if (!valor || !Number.isFinite(valor) || valor <= 0) {
    await redis.del(`${DOLAR_PREFIX}${periodo}`)
    return
  }
  await redis.set(`${DOLAR_PREFIX}${periodo}`, valor)
}
