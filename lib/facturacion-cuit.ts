import { Redis } from "@upstash/redis"

// CUIT(s) editables por cliente, usado en la sección de Facturación para
// poder identificar el/los dato(s) fiscal(es) de cada cliente. Un cliente
// puede tener más de un CUIT (ej: sedes con razón social distinta), por eso
// se guarda como array. No varía por mes. Sigue el mismo patrón que
// lib/facturacion-alias.ts.
const CUIT_PREFIX = "facturacion:cuit:"

function getRedisClient() {
  try {
    return Redis.fromEnv()
  } catch (error) {
    console.error("[facturacion-cuit] Error creando Redis client:", error)
    return null
  }
}

function normalize(value: unknown): string[] {
  if (!value) return []
  // Compat con el formato anterior (un único string, antes de soportar lista)
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string")
  return []
}

export async function getCuitList(clienteId: string): Promise<string[]> {
  const redis = getRedisClient()
  if (!redis) return []

  const value = await redis.get<string[] | string>(`${CUIT_PREFIX}${clienteId}`)
  return normalize(value)
}

export async function setCuitList(clienteId: string, cuits: string[]): Promise<void> {
  const redis = getRedisClient()
  if (!redis) throw new Error("Redis no está disponible")

  const limpio = cuits.map((c) => c.trim()).filter(Boolean)
  if (limpio.length === 0) {
    await redis.del(`${CUIT_PREFIX}${clienteId}`)
    return
  }

  await redis.set(`${CUIT_PREFIX}${clienteId}`, limpio)
}

/** Devuelve un mapa clienteId -> lista de CUIT para la lista de clienteIds dada. */
export async function getCuitLists(clienteIds: string[]): Promise<Record<string, string[]>> {
  const redis = getRedisClient()
  if (!redis || clienteIds.length === 0) return {}

  const valores = await Promise.all(
    clienteIds.map((id) => redis.get<string[] | string>(`${CUIT_PREFIX}${id}`)),
  )

  const resultado: Record<string, string[]> = {}
  clienteIds.forEach((id, idx) => {
    const lista = normalize(valores[idx])
    if (lista.length > 0) resultado[id] = lista
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
 * Devuelve TODOS los CUIT guardados (sin filtrar por una lista de clientes
 * conocida), ya que hay clientes de "Facturación sin IA" que no existen en
 * WhatsAppConfig.
 */
export async function getAllCuitLists(): Promise<Record<string, string[]>> {
  const redis = getRedisClient()
  if (!redis) return {}

  const keys = await scanKeys(redis, `${CUIT_PREFIX}*`)
  if (keys.length === 0) return {}

  const valores = await Promise.all(keys.map((key) => redis.get<string[] | string>(key)))

  const resultado: Record<string, string[]> = {}
  keys.forEach((key, idx) => {
    const lista = normalize(valores[idx])
    if (lista.length === 0) return
    const clienteId = key.slice(CUIT_PREFIX.length)
    resultado[clienteId] = lista
  })
  return resultado
}
