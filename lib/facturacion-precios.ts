import { Redis } from "@upstash/redis"

// Precio (valor por unidad) fijo por cliente, usado en la sección de
// Facturación para calcular el Valor Total = Valor por unidad x venta del dólar.
// Es un único valor por cliente (no varía por mes).
const PRECIO_UNIDAD_PREFIX = "facturacion:precio_unidad:"

function getRedisClient() {
  try {
    return Redis.fromEnv()
  } catch (error) {
    console.error("[facturacion-precios] Error creando Redis client:", error)
    return null
  }
}

export async function getPrecioUnidad(clienteId: string): Promise<number | null> {
  const redis = getRedisClient()
  if (!redis) return null

  const value = await redis.get<number | string>(`${PRECIO_UNIDAD_PREFIX}${clienteId}`)
  if (value === null || value === undefined) return null
  const num = typeof value === "string" ? parseFloat(value) : value
  return Number.isFinite(num) ? num : null
}

export async function setPrecioUnidad(clienteId: string, valor: number): Promise<void> {
  const redis = getRedisClient()
  if (!redis) throw new Error("Redis no está disponible")

  await redis.set(`${PRECIO_UNIDAD_PREFIX}${clienteId}`, valor)
}

/** Devuelve un mapa clienteId -> precio para la lista de clienteIds dada. */
export async function getPreciosUnidad(clienteIds: string[]): Promise<Record<string, number>> {
  const redis = getRedisClient()
  if (!redis || clienteIds.length === 0) return {}

  const valores = await Promise.all(
    clienteIds.map((id) => redis.get<number | string>(`${PRECIO_UNIDAD_PREFIX}${id}`)),
  )

  const resultado: Record<string, number> = {}
  clienteIds.forEach((id, idx) => {
    const value = valores[idx]
    if (value === null || value === undefined) return
    const num = typeof value === "string" ? parseFloat(value) : value
    if (Number.isFinite(num)) resultado[id] = num
  })
  return resultado
}

async function scanKeys(redis: Redis, pattern: string): Promise<string[]> {
  const allKeys: string[] = []
  let cursor = "0"
  do {
    const result = await redis.scan(cursor, { match: pattern, count: 100 })
    cursor = typeof result[0] === "number" ? result[0].toString() : result[0]
    allKeys.push(...result[1])
  } while (cursor !== "0")
  return allKeys
}

/**
 * Devuelve TODOS los precios guardados (sin filtrar por una lista de clientes
 * conocida), ya que hay clientes de "Facturación sin IA" que no existen en
 * WhatsAppConfig.
 */
export async function getAllPreciosUnidad(): Promise<Record<string, number>> {
  const redis = getRedisClient()
  if (!redis) return {}

  const keys = await scanKeys(redis, `${PRECIO_UNIDAD_PREFIX}*`)
  if (keys.length === 0) return {}

  const valores = await Promise.all(keys.map((key) => redis.get<number | string>(key)))

  const resultado: Record<string, number> = {}
  keys.forEach((key, idx) => {
    const value = valores[idx]
    if (value === null || value === undefined) return
    const num = typeof value === "string" ? parseFloat(value) : value
    if (!Number.isFinite(num)) return
    const clienteId = key.slice(PRECIO_UNIDAD_PREFIX.length)
    resultado[clienteId] = num
  })
  return resultado
}
