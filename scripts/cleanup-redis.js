#!/usr/bin/env node

/**
 * Script para limpiar conversaciones antiguas de Upstash Redis
 * Elimina todas las conversaciones con más de 30 días de antigüedad
 */

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
  
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Redis command failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.result;
}

async function getConversationKeys() {
  console.log("🔍 Buscando conversaciones...");
  
  try {
    // Obtener todas las claves que empiezan con "conversation:"
    const keys = await redisCommand("KEYS/conversation:*");
    console.log(`✓ Encontradas ${keys.length} conversaciones`);
    return keys || [];
  } catch (error) {
    console.error("Error al obtener claves:", error.message);
    return [];
  }
}

async function getLastMessageTimestamp(conversationKey) {
  try {
    // Obtener el último mensaje de la lista
    const lastMessage = await redisCommand(`LINDEX/${conversationKey}/-1`);
    
    if (!lastMessage) return null;

    let parsed;
    try {
      parsed = typeof lastMessage === "string" ? JSON.parse(lastMessage) : lastMessage;
    } catch {
      return null;
    }

    if (parsed?.timestamp) {
      const timestamp = new Date(parsed.timestamp).getTime();
      if (!isNaN(timestamp)) {
        return timestamp;
      }
    }

    return null;
  } catch (error) {
    console.error(`Error al leer ${conversationKey}:`, error.message);
    return null;
  }
}

async function deleteConversation(phoneNumber) {
  try {
    // Eliminar la conversación principal
    await redisCommand(`DEL/conversation:${phoneNumber}`);
    
    // Eliminar información de contacto
    await redisCommand(`DEL/conversation_contact:${phoneNumber}`);
    
    // Eliminar el conjunto de contactos
    await redisCommand(`DEL/conversation_contacts:${phoneNumber}`);
    
    // Eliminar estado de pausa
    await redisCommand(`DEL/conversation_paused:${phoneNumber}`);
    
    return true;
  } catch (error) {
    console.error(`Error al eliminar conversación ${phoneNumber}:`, error.message);
    return false;
  }
}

async function cleanupOldConversations() {
  console.log("📋 Iniciando limpieza de conversaciones antiguas...");
  console.log(`📅 Eliminando conversaciones anteriores a: ${new Date(CUTOFF_TIMESTAMP).toISOString()}`);
  console.log("");

  const conversationKeys = await getConversationKeys();
  
  if (conversationKeys.length === 0) {
    console.log("✓ No hay conversaciones para limpiar");
    return;
  }

  let oldCount = 0;
  let deletedCount = 0;
  const failures = [];

  for (let i = 0; i < conversationKeys.length; i++) {
    const key = conversationKeys[i];
    const phoneNumber = key.replace("conversation:", "");
    
    // Mostrar progreso cada 100 claves
    if ((i + 1) % 100 === 0) {
      console.log(`📊 Procesadas ${i + 1}/${conversationKeys.length} conversaciones...`);
    }

    const lastTimestamp = await getLastMessageTimestamp(key);
    
    if (lastTimestamp && lastTimestamp < CUTOFF_TIMESTAMP) {
      oldCount++;
      const deleted = await deleteConversation(phoneNumber);
      if (deleted) {
        deletedCount++;
      } else {
        failures.push(phoneNumber);
      }
    }
  }

  console.log("");
  console.log("=".repeat(50));
  console.log("📊 RESULTADO DE LA LIMPIEZA");
  console.log("=".repeat(50));
  console.log(`Total de conversaciones: ${conversationKeys.length}`);
  console.log(`Conversaciones antiguas encontradas: ${oldCount}`);
  console.log(`Conversaciones eliminadas: ${deletedCount}`);
  console.log(`Errores durante la eliminación: ${failures.length}`);
  
  if (failures.length > 0) {
    console.log("\n⚠️ Fallos en:");
    failures.slice(0, 10).forEach(phone => console.log(`  - ${phone}`));
    if (failures.length > 10) {
      console.log(`  ... y ${failures.length - 10} más`);
    }
  }

  console.log("=".repeat(50));
  console.log(`✓ Limpieza completada`);
}

cleanupOldConversations().catch((error) => {
  console.error("Error fatal:", error);
  process.exit(1);
});
