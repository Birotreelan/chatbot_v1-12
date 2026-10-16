/**
 * El valor por unidad de la pestaña Servicio (16/10/2026).
 *
 * Mismo patrón y misma forma que `lib/facturacion-precios.ts` —un número por
 * cliente, que no varía por mes—, con una clave propia.
 *
 * ── Por qué una clave propia y no reusar la de Facturación ─────────────────
 *
 * Porque son dos precios distintos: ese es todo el punto de la pestaña. Si
 * compartieran la clave, editar uno cambiaría el otro, que es exactamente lo
 * que se quiere evitar.
 *
 * Hasta septiembre de 2026 Servicio no usa esto: muestra lo que quedó
 * congelado en el cierre de Facturación. Ver lib/servicio-calculo.ts.
 */

import { Redis } from "@upstash/redis"

const PRECIO_PREFIX = "servicio:precio_unidad:"

function getRedisClient() {
  try {
    return Redis.fromEnv()
  } catch (error) {
    console.error("[servicio-precios] Error creando Redis client:", error)
    return null
  }
}

export async function setPrecioServicio(clienteId: string, valor: number): Promise<void> {
  const redis = getRedisClient()
  if (!redis) throw new Error("Redis no está disponible")
  await redis.set(`${PRECIO_PREFIX}${clienteId}`, valor)
}

async function scanKeys(redis: Redis, pattern: string): Promise<string[]> {
  const allKeys: string[] = []
  let cursor = "0"
  do {
    const result = await redis.scan(cursor, { match: pattern, count: 100 })
    cursor = String(result[0])
    allKeys.push(...result[1])
  } while (cursor !== "0")
  return allKeys
}

/**
 * Todos los precios de Servicio.
 *
 * Se escanean las claves, como en `getAllAliases`: los clientes de "sin IA" no
 * existen en WhatsAppConfig y quedarían afuera de una lista conocida.
 */
export async function getAllPreciosServicio(): Promise<Record<string, number>> {
  const redis = getRedisClient()
  if (!redis) return {}

  const keys = await scanKeys(redis, `${PRECIO_PREFIX}*`)
  if (keys.length === 0) return {}

  const valores = await Promise.all(keys.map((key) => redis.get<number | string>(key)))

  const resultado: Record<string, number> = {}
  keys.forEach((key, idx) => {
    const value = valores[idx]
    if (value === null || value === undefined) return
    const num = typeof value === "string" ? parseFloat(value) : value
    if (Number.isFinite(num)) resultado[key.slice(PRECIO_PREFIX.length)] = num
  })
  return resultado
}
