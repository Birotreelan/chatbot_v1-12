import { getRedisClient } from "@/lib/redis"

export async function GET(request: Request) {
  console.log("[RESET-API] Iniciando reset de estadísticas de conversaciones user-initiated...")

  const redis = getRedisClient()
  if (!redis) {
    return Response.json(
      { error: "Redis no disponible" },
      { status: 500 }
    )
  }

  try {
    // Obtener todos los clientes (buscar keys con patrón appointment_stats:*)
    const allStatsKeys = (await redis.keys("appointment_stats:*")) as string[]
    console.log(`[RESET-API] Se encontraron ${allStatsKeys.length} keys totales en Redis`)

    // Filtrar solo las keys principales (sin :daily: en el nombre)
    // Las keys principales tienen formato: appointment_stats:clienteId
    const mainStatsKeys = allStatsKeys.filter(key => !key.includes(":daily:"))
    console.log(`[RESET-API] Keys principales de clientes: ${mainStatsKeys.length}`)

    let resetCount = 0
    let dailyDeleted = 0
    let activeConversationDeleted = 0

    for (const key of mainStatsKeys) {
      const clienteId = key.replace("appointment_stats:", "")
      console.log(`[RESET-API] Procesando cliente: ${clienteId}`)

      // Resetear totalUserInitiated a 0 (solo en keys principales que son hashes)
      try {
        await redis.hset(key, { totalUserInitiated: 0 })
        resetCount++
        console.log(`[RESET-API] Resetado totalUserInitiated para ${clienteId}`)
      } catch (hsetError) {
        console.log(`[RESET-API] Key ${key} no es un hash, saltando...`)
      }
    }

    // Eliminar todas las keys de datos diarios de user_initiated
    const dailyUserInitiatedKeys = allStatsKeys.filter(key => key.includes(":daily:user_initiated"))
    console.log(`[RESET-API] Keys diarias de user_initiated a eliminar: ${dailyUserInitiatedKeys.length}`)
    
    for (const dailyKey of dailyUserInitiatedKeys) {
      await redis.del(dailyKey)
      dailyDeleted++
      console.log(`[RESET-API] Eliminado ${dailyKey}`)
    }

    // Eliminar todas las marcas de conversaciones activas
    const activeConversationKeys = (await redis.keys("active_user_conversation:*")) as string[]
    console.log(`[RESET-API] Se encontraron ${activeConversationKeys.length} conversaciones activas para eliminar`)

    for (const key of activeConversationKeys) {
      await redis.del(key)
      activeConversationDeleted++
    }

    const summary = {
      success: true,
      message: "Reset completado exitosamente",
      resumen: {
        clientesProccesados: resetCount,
        datoDiariosEliminados: dailyDeleted,
        conversacionesActivasEliminadas: activeConversationDeleted,
      },
    }

    console.log("\n[RESET-API] ===== RESUMEN DEL RESET =====")
    console.log(`[RESET-API] Contadores (totalUserInitiated) resetados: ${resetCount}`)
    console.log(`[RESET-API] Datos diarios (daily:user_initiated) eliminados: ${dailyDeleted}`)
    console.log(`[RESET-API] Marcas de conversaciones activas eliminadas: ${activeConversationDeleted}`)
    console.log("[RESET-API] ===== RESET COMPLETADO =====\n")

    return Response.json(summary)
  } catch (error) {
    console.error("[RESET-API] Error durante el reset:", error)
    return Response.json(
      { error: "Error durante el reset", details: String(error) },
      { status: 500 }
    )
  }
}
