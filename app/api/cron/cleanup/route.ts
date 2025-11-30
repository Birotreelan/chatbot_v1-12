import { NextResponse } from "next/server"
import { Redis } from "@upstash/redis"
import { incrementMetric, logError } from "@/lib/monitoring"

async function scanKeys(redis: Redis, pattern: string, maxKeys = 1000): Promise<string[]> {
  const keys: string[] = []
  let cursor = 0

  do {
    // SCAN returns [cursor, keys[]]
    const result = await redis.scan(cursor, { match: pattern, count: 100 })
    cursor = result[0]
    const foundKeys = result[1] as string[]

    keys.push(...foundKeys)

    // Stop if we've collected enough keys
    if (keys.length >= maxKeys) {
      break
    }
  } while (cursor !== 0)

  return keys.slice(0, maxKeys)
}

// Función para limpiar datos antiguos
export async function GET(req: Request) {
  try {
    const redis = Redis.fromEnv()
    const now = Date.now()

    // Configuración de días para limpieza
    const threadDays = Number(process.env.CLEANUP_THREAD_DAYS || 30)
    const metricsDays = Number(process.env.CLEANUP_LOGS_DAYS || 30)
    const cacheDays = Number(process.env.CLEANUP_CACHE_HOURS || 24) / 24 // Convertir horas a días

    const THREAD_CUTOFF = now - threadDays * 24 * 60 * 60 * 1000
    const METRICS_CUTOFF = now - metricsDays * 24 * 60 * 60 * 1000
    const CACHE_CUTOFF = now - cacheDays * 24 * 60 * 60 * 1000

    // Limitar el número de elementos a procesar en cada categoría para evitar timeouts
    const MAX_ITEMS_PER_CATEGORY = 1000

    // 1. Limpiar threads inactivos
    const threadKeys = await scanKeys(redis, "thread:*", MAX_ITEMS_PER_CATEGORY)
    let threadsDeleted = 0
    let threadsConverted = 0

    for (const key of threadKeys) {
      const threadData = await redis.get(key)
      if (threadData) {
        try {
          let thread: any = null

          // Try to parse as JSON first
          if (typeof threadData === "string" && threadData.startsWith("{")) {
            thread = JSON.parse(threadData)
          } else if (typeof threadData === "object") {
            thread = threadData
          } else {
            // Old format: just a threadId string like "thread_VAKW"
            // Convert to new format or delete if too old
            console.log(`[CLEANUP] Found old format thread data: ${threadData}`)

            // Since we don't have timestamp info for old format, delete it
            await redis.del(key)
            threadsDeleted++
            threadsConverted++
            continue
          }

          const lastMessageTime = thread.lastMessageAt ? new Date(thread.lastMessageAt).getTime() : 0

          if (lastMessageTime < THREAD_CUTOFF) {
            await redis.del(key)
            threadsDeleted++
          }
        } catch (e) {
          // Si no podemos parsear el thread, lo eliminamos por seguridad
          console.error(`[CLEANUP] Error parsing thread ${key}:`, e)
          await redis.del(key)
          threadsDeleted++
        }
      }
    }

    // 2. Limpiar métricas antiguas
    const metricKeys = await scanKeys(redis, "metrics:*", MAX_ITEMS_PER_CATEGORY)
    let metricsCleanedUp = 0

    for (const key of metricKeys) {
      const metrics = await redis.hgetall(key)
      if (metrics) {
        for (const [date, _] of Object.entries(metrics)) {
          // Si la fecha es anterior al cutoff y no es "total"
          if (date !== "total" && new Date(date).getTime() < METRICS_CUTOFF) {
            await redis.hdel(key, date)
            metricsCleanedUp++
          }
        }
      }
    }

    // 3. Limpiar caché de API
    const cacheKeys = await scanKeys(redis, "api_cache:*", MAX_ITEMS_PER_CATEGORY)
    let cacheEntriesDeleted = 0

    for (const key of cacheKeys) {
      const cacheData = await redis.get(key)
      if (cacheData) {
        try {
          const cache = JSON.parse(cacheData as string)
          const timestamp = cache.timestamp || 0

          if (timestamp < CACHE_CUTOFF) {
            await redis.del(key)
            cacheEntriesDeleted++
          }
        } catch (e) {
          // Si no podemos parsear la caché, la eliminamos
          await redis.del(key)
          cacheEntriesDeleted++
        }
      }
    }

    // 4. Limpiar datos de rate limiting antiguos
    const rateLimitKeys = await scanKeys(redis, "ratelimit:*", MAX_ITEMS_PER_CATEGORY)
    let rateLimitEntriesDeleted = 0

    for (const key of rateLimitKeys) {
      // Los datos de rate limiting se limpian automáticamente con TTL,
      // pero verificamos si hay alguno antiguo que no se haya limpiado
      const oldTokens = await redis.zcount(key, 0, CACHE_CUTOFF)

      if (oldTokens > 0) {
        await redis.zremrangebyscore(key, 0, CACHE_CUTOFF)
        rateLimitEntriesDeleted += oldTokens
      }
    }

    // Registrar la limpieza
    await incrementMetric("cleanup_threads_deleted", threadsDeleted)
    await incrementMetric("cleanup_threads_converted", threadsConverted)
    await incrementMetric("cleanup_metrics_deleted", metricsCleanedUp)
    await incrementMetric("cleanup_cache_deleted", cacheEntriesDeleted)
    await incrementMetric("cleanup_ratelimit_deleted", rateLimitEntriesDeleted)

    return NextResponse.json({
      success: true,
      threadsDeleted,
      threadsConverted,
      metricsCleanedUp,
      cacheEntriesDeleted,
      rateLimitEntriesDeleted,
      keysScanned: {
        threads: threadKeys.length,
        metrics: metricKeys.length,
        cache: cacheKeys.length,
        rateLimit: rateLimitKeys.length,
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Error en la limpieza programada:", error)
    await logError("cleanup", error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}

// Configuración para Vercel Cron
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// Configuración de cron usando la nueva sintaxis
export const maxDuration = 60 // 60 segundos máximo de ejecución (límite permitido)

// La configuración del cron se debe hacer en vercel.json
