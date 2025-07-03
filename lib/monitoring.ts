import { Redis } from "@upstash/redis"

// Prefijos para las métricas
const METRICS_PREFIX = "metrics:"
const ERROR_PREFIX = "errors:"

// Obtener cliente de Redis
function getRedisClient() {
  try {
    return Redis.fromEnv()
  } catch (error) {
    console.warn("Upstash Redis no está disponible:", error)
    return null
  }
}

// Simplificar el logging de métricas - solo errores críticos
export async function incrementMetric(name: string, value = 1): Promise<void> {
  if (process.env.ENABLE_MONITORING !== "true") return

  const redis = getRedisClient()
  if (!redis) return

  const key = `${METRICS_PREFIX}${name}`
  const date = new Date().toISOString().split("T")[0]
  const hour = new Date().getHours().toString().padStart(2, "0")

  try {
    await redis.hincrby(`${key}:hourly`, `${date}:${hour}`, value)
    await redis.hincrby(key, date, value)
    await redis.hincrby(key, "total", value)
  } catch (error) {
    // Solo log de errores críticos
    console.error(`[METRIC-ERROR] ${name}:`, error.message)
  }
}

// Función alias para incrementStats (para compatibilidad)
export async function incrementStats(name: string, value = 1): Promise<void> {
  return incrementMetric(name, value)
}

// Simplificar el logging de errores
export async function logError(category: string, error: Error | string): Promise<void> {
  const redis = getRedisClient()

  // Siempre mostrar errores en consola de forma limpia
  const errorMessage = error instanceof Error ? error.message : error
  console.error(`[ERROR-${category.toUpperCase()}] ${errorMessage}`)

  if (!redis) return

  const key = `${ERROR_PREFIX}${category}`
  const timestamp = new Date().toISOString()

  let serializedError: string
  if (error instanceof Error) {
    serializedError = JSON.stringify({
      timestamp,
      message: error.message,
      stack: error.stack || "",
    })
  } else {
    serializedError = JSON.stringify({
      timestamp,
      message: typeof error === "string" ? error : JSON.stringify(error),
      stack: "",
    })
  }

  try {
    await redis.lpush(key, serializedError)
    await redis.ltrim(key, 0, 99)
    await incrementMetric(`error:${category}`)
  } catch (e) {
    // Solo log crítico
    console.error(`[REDIS-ERROR] ${category}:`, e.message)
  }
}

// Obtener métricas
export async function getMetrics(name: string): Promise<Record<string, number>> {
  const redis = getRedisClient()
  if (!redis) return {}

  const key = `${METRICS_PREFIX}${name}`

  try {
    return (await redis.hgetall(key)) as Record<string, number>
  } catch (error) {
    console.error(`Error al obtener métricas ${name}:`, error)
    return {}
  }
}

// Obtener métricas por hora
export async function getHourlyMetrics(name: string, days = 1): Promise<Record<string, number>> {
  const redis = getRedisClient()
  if (!redis) return {}

  const key = `${METRICS_PREFIX}${name}:hourly`

  try {
    return (await redis.hgetall(key)) as Record<string, number>
  } catch (error) {
    console.error(`Error al obtener métricas horarias ${name}:`, error)
    return {}
  }
}

// Obtener errores recientes
export async function getRecentErrors(category: string, limit = 10): Promise<any[]> {
  const redis = getRedisClient()
  if (!redis) return []

  const key = `${ERROR_PREFIX}${category}`

  try {
    const errors = await redis.lrange(key, 0, limit - 1)

    // Asegurarse de que cada error sea un JSON válido
    return errors.map((e) => {
      try {
        return JSON.parse(e as string)
      } catch (parseError) {
        console.error(`Error al parsear error de Redis: ${e}`, parseError)
        return {
          timestamp: new Date().toISOString(),
          message: `[Error corrupto: ${e}]`,
          stack: `Error al parsear JSON: ${parseError}`,
        }
      }
    })
  } catch (error) {
    console.error(`Error al obtener errores recientes ${category}:`, error)
    return []
  }
}

// Obtener todas las categorías de errores
export async function getErrorCategories(): Promise<string[]> {
  const redis = getRedisClient()
  if (!redis) return []

  try {
    const keys = await redis.keys(`${ERROR_PREFIX}*`)
    return keys.map((key) => key.replace(ERROR_PREFIX, ""))
  } catch (error) {
    console.error("Error al obtener categorías de errores:", error)
    return []
  }
}
