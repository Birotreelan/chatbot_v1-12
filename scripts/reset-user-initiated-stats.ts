/**
 * Script para resetear los contadores de conversaciones user-initiated
 * 
 * Esto limpia:
 * - totalUserInitiated (contador total)
 * - daily:user_initiated (datos diarios)
 * - active_user_conversation:* (marcas de conversaciones activas)
 * 
 * NOTA: Este reset es necesario porque los datos anteriores contabilizaban
 * mensajes individuales en lugar de conversaciones.
 */

import { Redis } from "@upstash/redis"

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

async function resetUserInitiatedStats() {
  console.log("=== Iniciando reset de estadísticas user-initiated ===\n")

  try {
    // 1. Buscar todas las keys de appointment_stats
    const statsKeys = await redis.keys("appointment_stats:*")
    console.log(`Encontradas ${statsKeys.length} keys de estadísticas\n`)

    let resetCount = 0

    for (const key of statsKeys) {
      // Solo procesar keys principales (no las de daily)
      if (key.includes(":daily:")) continue

      const clienteId = key.replace("appointment_stats:", "")
      console.log(`Procesando cliente: ${clienteId}`)

      // Obtener valor actual para logging
      const currentValue = await redis.hget(key, "totalUserInitiated")
      console.log(`  - totalUserInitiated actual: ${currentValue || 0}`)

      // Resetear el contador total a 0
      await redis.hset(key, { totalUserInitiated: 0 })
      console.log(`  - totalUserInitiated reseteado a 0`)

      // Eliminar datos diarios de user_initiated
      const dailyKey = `${key}:daily:user_initiated`
      const dailyData = await redis.hgetall(dailyKey)
      if (dailyData && Object.keys(dailyData).length > 0) {
        await redis.del(dailyKey)
        console.log(`  - Eliminados ${Object.keys(dailyData).length} registros diarios`)
      }

      resetCount++
    }

    // 2. Limpiar todas las marcas de conversaciones activas
    const activeConversationKeys = await redis.keys("active_user_conversation:*")
    if (activeConversationKeys.length > 0) {
      for (const key of activeConversationKeys) {
        await redis.del(key)
      }
      console.log(`\nEliminadas ${activeConversationKeys.length} marcas de conversaciones activas`)
    }

    console.log(`\n=== Reset completado ===`)
    console.log(`Clientes procesados: ${resetCount}`)
    console.log(`Marcas de conversación eliminadas: ${activeConversationKeys.length}`)

  } catch (error) {
    console.error("Error durante el reset:", error)
    throw error
  }
}

// Ejecutar
resetUserInitiatedStats()
  .then(() => {
    console.log("\nScript finalizado exitosamente")
    process.exit(0)
  })
  .catch((error) => {
    console.error("\nScript finalizado con error:", error)
    process.exit(1)
  })
