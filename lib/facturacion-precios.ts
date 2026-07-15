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
