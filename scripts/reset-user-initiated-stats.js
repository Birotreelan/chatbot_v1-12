const { Redis } = require("@upstash/redis");

async function resetUserInitiatedStats() {
  console.log("[RESET] Iniciando reset de estadísticas de conversaciones user-initiated...");

  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  try {
    // Obtener todos los clientes (buscar keys con patrón appointment_stats:)
    const statsKeys = await redis.keys("appointment_stats:*");
    console.log(`[RESET] Se encontraron ${statsKeys.length} clientes en Redis`);

    let resetCount = 0;
    let dailyDeleted = 0;
    let activeConversationDeleted = 0;

    for (const key of statsKeys) {
      const clienteId = key.replace("appointment_stats:", "");
      console.log(`[RESET] Procesando cliente: ${clienteId}`);

      // Resetear totalUserInitiated a 0
      await redis.hset(key, { totalUserInitiated: 0 });
      resetCount++;
      console.log(`[RESET] ✓ Resetado totalUserInitiated para ${clienteId}`);

      // Eliminar datos diarios de user_initiated
      const dailyKey = `${key}:daily:user_initiated`;
      const dailyDeletes = await redis.del(dailyKey);
      if (dailyDeletes > 0) {
        dailyDeleted++;
        console.log(`[RESET] ✓ Eliminado ${dailyKey}`);
      }
    }

    // Eliminar todas las marcas de conversaciones activas
    const activeConversationKeys = await redis.keys("active_user_conversation:*");
    console.log(`[RESET] Se encontraron ${activeConversationKeys.length} conversaciones activas para eliminar`);

    for (const key of activeConversationKeys) {
      await redis.del(key);
      activeConversationDeleted++;
    }

    console.log("\n[RESET] ===== RESUMEN DEL RESET =====");
    console.log(`[RESET] Contadores (totalUserInitiated) resetados: ${resetCount}`);
    console.log(`[RESET] Datos diarios (daily:user_initiated) eliminados: ${dailyDeleted}`);
    console.log(`[RESET] Marcas de conversaciones activas eliminadas: ${activeConversationDeleted}`);
    console.log("[RESET] ===== RESET COMPLETADO =====\n");
  } catch (error) {
    console.error("[RESET] Error durante el reset:", error);
    process.exit(1);
  }
}

resetUserInitiatedStats();
