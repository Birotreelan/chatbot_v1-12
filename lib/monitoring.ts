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

// Incrementar contador de métricas
export async function incrementMetric(name: string, value = 1): Promise<void> {
  if (process.env.ENABLE_MONITORING !== "true") return

  const redis = getRedisClient()
  if (!redis) return

  const key = `${METRICS_PREFIX}${name}`
  const date = new Date().toISOString().split("T")[0] // YYYY-MM-DD
  const hour = new Date().getHours().toString().padStart(2, "0") // HH

  try {
    // Incrementar contador por hora (para análisis detallado)
    await redis.hincrby(`${key}:hourly`, `${date}:${hour}`, value)

    // Incrementar contador diario
    await redis.hincrby(key, date, value)

    // Incrementar contador total
    await redis.hincrby(key, "total", value)
  } catch (error) {
    console.error(`Error al incrementar métrica ${name}:`, error)
  }
}

// Función alias para incrementStats (para compatibilidad)
export async function incrementStats(name: string, value = 1): Promise<void> {
  return incrementMetric(name, value)
}

// Registrar error
export async function logError(category: string, error: Error | string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) {
    // Si no hay Redis, al menos logueamos en consola
    console.error(`[ERROR][${category}]`, error)
    return
  }

  const key = `${ERROR_PREFIX}${category}`
  const timestamp = new Date().toISOString()

  // Asegurarse de que el error sea serializable
  let errorMessage: string
  let errorStack = ""

  if (error instanceof Error) {
    errorMessage = error.message
    errorStack = error.stack || ""
  } else if (typeof error === "string") {
    errorMessage = error
  } else {
    // Si es otro tipo de objeto, convertirlo a string de forma segura
    try {
      errorMessage = JSON.stringify(error)
    } catch (e) {
      errorMessage = `[Error no serializable: ${typeof error}]`
    }
  }

  try {
    // Crear objeto de error serializable
    const errorObject = {
      timestamp,
      message: errorMessage,
      stack: errorStack,
    }

    // Serializar a JSON antes de guardar
    const serializedError = JSON.stringify(errorObject)

    // Guardar error con timestamp
    await redis.lpush(key, serializedError)

    // Limitar la lista a 100 errores
    await redis.ltrim(key, 0, 99)

    // Incrementar contador de errores
    await incrementMetric(`error:${category}`)

    // Verificar si debemos enviar una alerta
    const errorThreshold = Number(process.env.ALERT_ERROR_THRESHOLD || 10)
    const recentErrorCount = await redis.llen(key)

    if (recentErrorCount >= errorThreshold) {
      // Aquí se podría implementar un sistema de alertas
      console.error(`ALERTA: Se han detectado ${recentErrorCount} errores en la categoría ${category}`)
    }
  } catch (e) {
    console.error(`Error al registrar error ${category}:`, e)
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
