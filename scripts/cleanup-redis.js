#!/usr/bin/env node

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!UPSTASH_URL || !UPSTASH_TOKEN) {
  console.error("Error: Las variables UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN no están configuradas");
  process.exit(1);
}

const DAYS_TO_KEEP = 30;
const CUTOFF_TIMESTAMP = Date.now() - DAYS_TO_KEEP * 24 * 60 * 60 * 1000;

async function redisCommand(command) {
  const url = `${UPSTASH_URL}/${command}`;
  
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Redis command failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Error executing command: ${command}`, error.message);
    throw error;
  }
}

async function cleanup() {
  console.log("[INFO] Iniciando limpieza de conversaciones de más de 30 días...");
  console.log(`[INFO] Fecha límite: ${new Date(CUTOFF_TIMESTAMP).toISOString()}`);

  try {
    // Obtener todas las claves
    console.log("[INFO] Obteniendo todas las claves de conversaciones...");
    const keysResult = await redisCommand("KEYS/conversation:*");
    const keys = keysResult.result || [];
    
    console.log(`[INFO] Total de claves encontradas: ${keys.length}`);

    let deletedConversations = 0;
    let deletedMessages = 0;
    let deletedContacts = 0;

    // Procesar cada conversación
    for (const conversationKey of keys) {
      try {
        // Obtener el rango de la conversación para verificar si está vacía o vieja
        const llenResult = await redisCommand(`LLEN/${conversationKey}`);
        const messageCount = llenResult.result || 0;

        if (messageCount === 0) {
          // Eliminar clave vacía
          await redisCommand(`DEL/${conversationKey}`);
          deletedConversations++;
          continue;
        }

        // Obtener el primer mensaje para obtener la fecha
        const firstMessageResult = await redisCommand(`LINDEX/${conversationKey}/0`);
        const firstMessageStr = firstMessageResult.result;

        if (!firstMessageStr) {
          continue;
        }

        try {
          const firstMessage = JSON.parse(firstMessageStr);
          const messageTimestamp = firstMessage.timestamp || 0;

          if (messageTimestamp < CUTOFF_TIMESTAMP) {
            // Eliminar conversación antigua
            await redisCommand(`DEL/${conversationKey}`);
            deletedConversations++;
            deletedMessages += messageCount;

            // Extraer número de teléfono de la clave
            const phoneNumber = conversationKey.replace("conversation:", "");
            
            // Eliminar contacto asociado
            await redisCommand(`DEL/contact:${phoneNumber}`);
            deletedContacts++;

            console.log(`[DELETED] Conversación ${phoneNumber}: ${messageCount} mensajes eliminados (fecha: ${new Date(messageTimestamp).toISOString()})`);
          }
        } catch (parseError) {
          console.warn(`[WARN] No se pudo parsear mensaje de ${conversationKey}`);
        }
      } catch (keyError) {
        console.warn(`[WARN] Error procesando clave ${conversationKey}:`, keyError.message);
      }
    }

    console.log("\n[SUCCESS] Limpieza completada:");
    console.log(`  - Conversaciones eliminadas: ${deletedConversations}`);
    console.log(`  - Mensajes eliminados: ${deletedMessages}`);
    console.log(`  - Contactos eliminados: ${deletedContacts}`);
    console.log(`  - Total de claves antes: ${keys.length}`);
    console.log(`  - Total de claves después: ${keys.length - deletedConversations}`);

  } catch (error) {
    console.error("[ERROR] Error durante la limpieza:", error.message);
    process.exit(1);
  }
}

// Ejecutar limpieza
cleanup().catch(error => {
  console.error("[FATAL] Error no manejado:", error);
  process.exit(1);
});
