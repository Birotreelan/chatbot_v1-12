import { Redis } from "@upstash/redis"

// Alias editable por cliente, usado en la sección de Facturación para
// identificar mejor a cada cliente (independiente del nombre interno del
// dashboard, WhatsAppConfig.alias). Es un único valor por cliente, no varía
// por mes. Sigue el mismo patrón que lib/facturacion-precios.ts.
const ALIAS_PREFIX = "facturacion:alias:"

function getRedisClient() {
  try {
    return Redis.fromEnv()
  } catch (error) {
    console.error("[facturacion-alias] Error creando Redis client:", error)
    return null
  }
}

export async function getAlias(clienteId: string): Promise<string | null> {
  const redis = getRedisClient()
  if (!redis) return null

  const value = await redis.get<string>(`${ALIAS_PREFIX}${clienteId}`)
  return value ?? null
}

export async function setAlias(clienteId: string, alias: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) throw new Error("Redis no está disponible")

  const trimmed = alias.trim()
  if (!trimmed) {
    // Alias vacío: se borra la key en vez de guardar un string vacío
    await redis.del(`${ALIAS_PREFIX}${clienteId}`)
    return
  }

  await redis.set(`${ALIAS_PREFIX}${clienteId}`, trimmed)
}

/** Devuelve un mapa clienteId -> alias para la lista de clienteIds dada. */
export async function getAliases(clienteIds: string[]): Promise<Record<string, string>> {
  const redis = getRedisClient()
  if (!redis || clienteIds.length === 0) return {}

  const valores = await Promise.all(clienteIds.map((id) => redis.get<string>(`${ALIAS_PREFIX}${id}`)))

  const resultado: Record<string, string> = {}
  clienteIds.forEach((id, idx) => {
    const value = valores[idx]
    if (value) resultado[id] = value
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
 * Devuelve TODOS los alias guardados (sin filtrar por una lista de clientes
 * conocida), ya que hay clientes de "Facturación sin IA" que no existen en
 * WhatsAppConfig.
 */
export async function getAllAliases(): Promise<Record<string, string>> {
  const redis = getRedisClient()
  if (!redis) return {}

  const keys = await scanKeys(redis, `${ALIAS_PREFIX}*`)
  if (keys.length === 0) return {}

  const valores = await Promise.all(keys.map((key) => redis.get<string>(key)))

  const resultado: Record<string, string> = {}
  keys.forEach((key, idx) => {
    const value = valores[idx]
    if (!value) return
    const clienteId = key.slice(ALIAS_PREFIX.length)
    resultado[clienteId] = value
  })
  return resultado
}
