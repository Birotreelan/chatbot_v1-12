import { type NextRequest, NextResponse } from "next/server"
import { Redis } from "@upstash/redis"
import { incrementMetric, logError } from "@/lib/monitoring"
import { cleanupOldConversations } from "@/lib/db"

// Función para limpiar datos antiguos
export async function GET(req: NextRequest) {
  try {
    console.log("[CLEANUP] ========== INICIANDO LIMPIEZA AUTOMÁTICA ==========")

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

    // 1. Limpiar conversaciones antiguas (7 días)
    const conversationsDeleted = await cleanupOldConversations()
    console.log(`[CLEANUP] ✅ Conversaciones eliminadas: ${conversationsDeleted}`)

    // 2. Limpiar threads inactivos
    const threadKeys = await redis.keys("whatsapp_thread:*")
    let threadsDeleted = 0

    // Limitar el número de threads a procesar
    const threadsToProcess = threadKeys.slice(0, MAX_ITEMS_PER_CATEGORY)

    for (const key of threadsToProcess) {
      const threadData = await redis.get(key)
      if (threadData) {
        try {
          const thread = JSON.parse(threadData as string)
          const lastMessageTime = thread.lastMessageAt ? new Date(thread.lastMessageAt).getTime() : 0

          if (lastMessageTime < THREAD_CUTOFF) {
            await redis.del(key)
            threadsDeleted++
          }
        } catch (e) {
          // Si no podemos parsear el thread, lo eliminamos por seguridad
          await redis.del(key)
          threadsDeleted++
        }
      }
    }
    console.log(`[CLEANUP] ✅ Threads eliminados: ${threadsDeleted}`)

    // 3. Limpiar métricas antiguas
    const metricKeys = await redis.keys("metrics:*")
    let metricsCleanedUp = 0

    // Limitar el número de métricas a procesar
    const metricsToProcess = metricKeys.slice(0, MAX_ITEMS_PER_CATEGORY)

    for (const key of metricsToProcess) {
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
    console.log(`[CLEANUP] ✅ Métricas eliminadas: ${metricsCleanedUp}`)

    // 4. Limpiar caché de API
    const cacheKeys = await redis.keys("api_cache:*")
    let cacheEntriesDeleted = 0

    // Limitar el número de entradas de caché a procesar
    const cacheToProcess = cacheKeys.slice(0, MAX_ITEMS_PER_CATEGORY)

    for (const key of cacheToProcess) {
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
    console.log(`[CLEANUP] ✅ Entradas de caché eliminadas: ${cacheEntriesDeleted}`)

    // 5. Limpiar datos de rate limiting antiguos
    const rateLimitKeys = await redis.keys("ratelimit:*")
    let rateLimitEntriesDeleted = 0

    // Limitar el número de entradas de rate limiting a procesar
    const rateLimitToProcess = rateLimitKeys.slice(0, MAX_ITEMS_PER_CATEGORY)

    for (const key of rateLimitToProcess) {
      // Los datos de rate limiting se limpian automáticamente con TTL,
      // pero verificamos si hay alguno antiguo que no se haya limpiado
      const oldTokens = await redis.zcount(key, 0, CACHE_CUTOFF)

      if (oldTokens > 0) {
        await redis.zremrangebyscore(key, 0, CACHE_CUTOFF)
        rateLimitEntriesDeleted += oldTokens
      }
    }
    console.log(`[CLEANUP] ✅ Entradas de rate limiting eliminadas: ${rateLimitEntriesDeleted}`)

    // Registrar la limpieza
    await incrementMetric("cleanup_conversations_deleted", conversationsDeleted)
    await incrementMetric("cleanup_threads_deleted", threadsDeleted)
    await incrementMetric("cleanup_metrics_deleted", metricsCleanedUp)
    await incrementMetric("cleanup_cache_deleted", cacheEntriesDeleted)
    await incrementMetric("cleanup_ratelimit_deleted", rateLimitEntriesDeleted)

    // Indicar si hay más elementos por procesar
    const remainingThreads = threadKeys.length - threadsToProcess.length
    const remainingMetrics = metricKeys.length - metricsToProcess.length
    const remainingCache = cacheKeys.length - cacheToProcess.length
    const remainingRateLimit = rateLimitKeys.length - rateLimitToProcess.length

    const result = {
      success: true,
      message: "Limpieza completada exitosamente",
      deleted: {
        conversations: conversationsDeleted,
        threads: threadsDeleted,
        metrics: metricsCleanedUp,
        cache: cacheEntriesDeleted,
        rateLimit: rateLimitEntriesDeleted,
      },
      remaining: {
        threads: remainingThreads,
        metrics: remainingMetrics,
        cache: remainingCache,
        rateLimit: remainingRateLimit,
      },
      timestamp: new Date().toISOString(),
    }

    console.log("[CLEANUP] ========== LIMPIEZA COMPLETADA ==========")
    console.log(`[CLEANUP] Resultado:`, result)

    return NextResponse.json(result)
  } catch (error) {
    console.error("[CLEANUP] ❌ Error durante la limpieza:", error)
    await logError("cleanup_cron", error instanceof Error ? error : new Error(String(error)))

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error durante la limpieza",
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    )
  }
}

// También permitir POST para compatibilidad con diferentes cron services
export async function POST(request: NextRequest) {
  return GET(request)
}

// Configuración para Vercel Cron
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// Configuración de cron usando la nueva sintaxis
export const maxDuration = 60 // 60 segundos máximo de ejecución (límite permitido)

// La configuración del cron se debe hacer en vercel.json
