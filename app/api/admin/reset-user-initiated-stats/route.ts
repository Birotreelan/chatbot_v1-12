import { getRedisClient } from "@/lib/redis"

export async function GET() {
  console.log("[RESET-API] Iniciando reset de estadísticas de conversaciones user-initiated...")

  const redis = getRedisClient()
  if (!redis) {
    return Response.json(
      { error: "Redis no disponible" },
      { status: 500 }
    )
  }

  try {
    let resetCount = 0
    let dailyDeleted = 0
    let activeConversationDeleted = 0
    const errors: string[] = []

    // 1. Eliminar todas las keys de datos diarios de user_initiated
    const dailyUserInitiatedKeys = (await redis.keys("appointment_stats:*:daily:user_initiated")) as string[]
    console.log(`[RESET-API] Keys diarias de user_initiated encontradas: ${dailyUserInitiatedKeys.length}`)
    
    for (const dailyKey of dailyUserInitiatedKeys) {
      try {
        await redis.del(dailyKey)
        dailyDeleted++
        console.log(`[RESET-API] Eliminado ${dailyKey}`)
      } catch (e) {
        errors.push(`Error eliminando ${dailyKey}: ${e}`)
      }
    }

    // 2. Eliminar todas las marcas de conversaciones activas
    const activeConversationKeys = (await redis.keys("active_user_conversation:*")) as string[]
    console.log(`[RESET-API] Conversaciones activas encontradas: ${activeConversationKeys.length}`)

    for (const key of activeConversationKeys) {
      try {
        await redis.del(key)
        activeConversationDeleted++
        console.log(`[RESET-API] Eliminado ${key}`)
      } catch (e) {
        errors.push(`Error eliminando ${key}: ${e}`)
      }
    }

    // 3. Resetear totalUserInitiated en las keys principales de estadísticas
    // Solo buscamos keys que NO contengan :daily: para obtener las principales
    const allStatsKeys = (await redis.keys("appointment_stats:*")) as string[]
    const mainStatsKeys = allStatsKeys.filter(key => !key.includes(":daily:"))
    console.log(`[RESET-API] Keys principales de estadísticas: ${mainStatsKeys.length}`)

    for (const key of mainStatsKeys) {
      try {
        // Usar HDEL para eliminar solo el campo totalUserInitiated sin tocar el resto
        // HDEL es seguro incluso si el campo no existe (retorna 0 pero no falla)
        const deletedFields = await redis.hdel(key, "totalUserInitiated")
        
        // Luego re-establecer el valor a 0
        await redis.hset(key, { totalUserInitiated: 0 })
        resetCount++
        console.log(`[RESET-API] Resetado totalUserInitiated en ${key}`)
      } catch (e) {
        console.log(`[RESET-API] Error procesando ${key}: ${String(e)}`)
        errors.push(`Error en ${key}: ${String(e)}`)
      }
    }

    const summary = {
      success: true,
      message: "Reset completado exitosamente",
      resumen: {
        contadoresReseteados: resetCount,
        datosDiariosEliminados: dailyDeleted,
        conversacionesActivasEliminadas: activeConversationDeleted,
        errores: errors.length > 0 ? errors : undefined,
      },
    }

    console.log("\n[RESET-API] ===== RESUMEN DEL RESET =====")
    console.log(`[RESET-API] Contadores (totalUserInitiated) resetados: ${resetCount}`)
    console.log(`[RESET-API] Datos diarios (daily:user_initiated) eliminados: ${dailyDeleted}`)
    console.log(`[RESET-API] Marcas de conversaciones activas eliminadas: ${activeConversationDeleted}`)
    if (errors.length > 0) {
      console.log(`[RESET-API] Errores encontrados: ${errors.length}`)
    }
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
