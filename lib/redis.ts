import { Redis } from "@upstash/redis"

// Singleton del cliente Redis
let redis: Redis | null = null

// Función para obtener el cliente Redis
export function getRedisClient() {
  if (redis) return redis

  try {
    // Inicializar el cliente Redis usando las variables de entorno de Upstash
    redis = Redis.fromEnv()
    return redis
  } catch (error) {
    console.warn("Upstash Redis no está disponible:", error)
    return null
  }
}

// --- named export expected by other modules ---
export { redis }
