import { Redis } from "@upstash/redis"

// Función para obtener el cliente de Redis
function getRedisClient(): Redis | null {
  try {
    return Redis.fromEnv()
  } catch (error) {
    console.warn("[LOCK] ⚠️ Redis no disponible:", error)
    return null
  }
}

export class DistributedLock {
  private redis: Redis | null
  private lockKey: string
  private lockValue: string
  private lockTimeout: number // en segundos
  private acquired = false

  constructor(lockKey: string, lockTimeout = 30) {
    this.redis = getRedisClient()
    this.lockKey = `lock:${lockKey}`
    this.lockValue = `${Date.now()}-${Math.random().toString(36).substring(7)}`
    this.lockTimeout = lockTimeout
  }

  /**
   * Intenta adquirir el lock con reintentos
   * @param maxRetries Número máximo de reintentos
   * @param retryDelay Delay entre reintentos en ms
   * @returns true si se adquirió el lock, false si no
   */
  async acquire(maxRetries = 10, retryDelay = 100): Promise<boolean> {
    if (!this.redis) {
      console.warn("[LOCK] ⚠️ Redis no disponible, permitiendo operación sin lock")
      this.acquired = true
      return true
    }

    let attempts = 0

    while (attempts < maxRetries) {
      try {
        console.log(`[LOCK] 🔒 Intentando adquirir lock: ${this.lockKey} (intento ${attempts + 1}/${maxRetries})`)

        // Usar SET con NX (solo si no existe) y EX (expiración)
        // Esto es atómico en Redis
        const result = await this.redis.set(this.lockKey, this.lockValue, {
          nx: true, // Solo establecer si no existe
          ex: this.lockTimeout, // Expiración en segundos
        })

        if (result === "OK") {
          this.acquired = true
          console.log(`[LOCK] ✅ Lock adquirido: ${this.lockKey}`)
          return true
        }

        // Si no se pudo adquirir, verificar si el lock está expirado
        const currentValue = await this.redis.get(this.lockKey)
        if (!currentValue) {
          // El lock fue liberado entre medio, reintentar inmediatamente
          console.log(`[LOCK] 🔄 Lock liberado, reintentando inmediatamente`)
          continue
        }

        console.log(`[LOCK] ⏳ Lock ocupado, esperando ${retryDelay}ms antes de reintentar`)
        await new Promise((resolve) => setTimeout(resolve, retryDelay))
        attempts++
      } catch (error) {
        console.error(`[LOCK] ❌ Error al intentar adquirir lock:`, error)
        attempts++
        await new Promise((resolve) => setTimeout(resolve, retryDelay))
      }
    }

    console.error(`[LOCK] ❌ No se pudo adquirir lock después de ${maxRetries} intentos: ${this.lockKey}`)
    return false
  }

  /**
   * Libera el lock solo si fue adquirido por esta instancia
   */
  async release(): Promise<void> {
    if (!this.redis || !this.acquired) {
      return
    }

    try {
      console.log(`[LOCK] 🔓 Liberando lock: ${this.lockKey}`)

      // Verificar que el lock todavía nos pertenece antes de liberarlo
      const currentValue = await this.redis.get(this.lockKey)

      if (currentValue === this.lockValue) {
        await this.redis.del(this.lockKey)
        console.log(`[LOCK] ✅ Lock liberado exitosamente: ${this.lockKey}`)
      } else {
        console.warn(`[LOCK] ⚠️ Lock ya no nos pertenece o expiró: ${this.lockKey}`)
      }

      this.acquired = false
    } catch (error) {
      console.error(`[LOCK] ❌ Error al liberar lock:`, error)
    }
  }

  /**
   * Extiende el tiempo de expiración del lock
   */
  async extend(additionalSeconds = 30): Promise<boolean> {
    if (!this.redis || !this.acquired) {
      return false
    }

    try {
      const currentValue = await this.redis.get(this.lockKey)

      if (currentValue === this.lockValue) {
        await this.redis.expire(this.lockKey, additionalSeconds)
        console.log(`[LOCK] ⏰ Lock extendido por ${additionalSeconds}s: ${this.lockKey}`)
        return true
      }

      console.warn(`[LOCK] ⚠️ No se pudo extender lock, ya no nos pertenece: ${this.lockKey}`)
      return false
    } catch (error) {
      console.error(`[LOCK] ❌ Error al extender lock:`, error)
      return false
    }
  }
}

/**
 * Ejecuta una función con un lock distribuido
 * @param lockKey Clave única para el lock
 * @param fn Función a ejecutar con el lock
 * @param lockTimeout Timeout del lock en segundos
 * @param maxRetries Número máximo de reintentos para adquirir el lock
 * @returns El resultado de la función
 */
export async function withLock<T>(
  lockKey: string,
  fn: () => Promise<T>,
  lockTimeout = 30,
  maxRetries = 10,
): Promise<T> {
  const lock = new DistributedLock(lockKey, lockTimeout)

  try {
    const acquired = await lock.acquire(maxRetries)

    if (!acquired) {
      throw new Error(`No se pudo adquirir lock después de ${maxRetries} intentos: ${lockKey}`)
    }

    // Ejecutar la función protegida
    const result = await fn()

    return result
  } finally {
    // Siempre liberar el lock, incluso si hay error
    await lock.release()
  }
}
