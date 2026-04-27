#!/usr/bin/env node

/**
 * Script para eliminar conversaciones mayores a 30 días de Upstash Redis
 * Ejecutar con: node scripts/cleanup-old-conversations.js
 */

import { Redis } from "@upstash/redis";

// Configuración
const DAYS_TO_KEEP = 30;
const CUTOFF_DATE = new Date(Date.now() - DAYS_TO_KEEP * 24 * 60 * 60 * 1000);

// Prefijos de claves
const CONVERSATION_PREFIX = "conversation:";
const CONVERSATION_CONTACT_PREFIX = "conversation_contact:";
const CONVERSATION_CONTACTS_SET_PREFIX = "conversation_contacts:";
const CONVERSATION_PAUSED_PREFIX = "conversation_paused:";

async function scanRedisKeys(redis, pattern) {
  const allKeys = [];
  let cursor = "0";

  do {
    const result = await redis.scan(cursor, {
      match: pattern,
      count: 500,
    });
    cursor = typeof result[0] === "number" ? result[0].toString() : result[0];
    allKeys.push(...result[1]);
  } while (cursor !== "0");

  return allKeys;
}

async function getLastMessageDate(redis, conversationKey) {
  try {
    const lastMessage = await redis.lindex(conversationKey, -1);

    if (!lastMessage) return null;

    let parsed;
    if (typeof lastMessage === "string") {
      parsed = JSON.parse(lastMessage);
    } else {
      parsed = lastMessage;
    }

    if (parsed?.timestamp) {
      const date = new Date(parsed.timestamp);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }

    return null;
  } catch (error) {
    console.error(`Error leyendo último mensaje de ${conversationKey}:`, error.message);
    return null;
  }
}

async function cleanupOldConversations() {
  const stats = {
    conversationsDeleted: 0,
    contactsDeleted: 0,
    messagesDeleted: 0,
    keysScanned: 0,
    errors: 0,
  };

  console.log("=".repeat(60));
  console.log("LIMPIEZA DE CONVERSACIONES ANTIGUAS");
  console.log("=".repeat(60));
  console.log(`Fecha de corte: ${CUTOFF_DATE.toISOString()}`);
  console.log(`Se eliminarán conversaciones anteriores a ${DAYS_TO_KEEP} días`);
  console.log("");

  try {
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });

    // 1. Escanear todas las conversaciones
    console.log("Escaneando conversaciones...");
    const conversationKeys = await scanRedisKeys(redis, `${CONVERSATION_PREFIX}*`);
    console.log(`Encontradas ${conversationKeys.length} conversaciones`);
    stats.keysScanned = conversationKeys.length;

    const keysToDelete = [];
    const contactKeysToDelete = [];
    const phoneNumbersToRemoveFromSets = new Map();

    // 2. Verificar cada conversación
    console.log("\nAnalizando fechas de conversaciones...");
    let processed = 0;

    for (const conversationKey of conversationKeys) {
      processed++;
      if (processed % 100 === 0) {
        console.log(`  Procesadas ${processed}/${conversationKeys.length}...`);
      }

      try {
        const lastMessageDate = await getLastMessageDate(redis, conversationKey);

        if (!lastMessageDate) {
          keysToDelete.push(conversationKey);

          const parts = conversationKey.replace(CONVERSATION_PREFIX, "").split(":");
          if (parts.length >= 2) {
            const configId = parts[0];
            const phoneNumber = parts.slice(1).join(":");

            const contactKey = `${CONVERSATION_CONTACT_PREFIX}${configId}:${phoneNumber}`;
            contactKeysToDelete.push(contactKey);

            if (!phoneNumbersToRemoveFromSets.has(configId)) {
              phoneNumbersToRemoveFromSets.set(configId, []);
            }
            phoneNumbersToRemoveFromSets.get(configId).push(phoneNumber);
          }
          continue;
        }

        if (lastMessageDate < CUTOFF_DATE) {
          keysToDelete.push(conversationKey);

          const messageCount = await redis.llen(conversationKey);
          stats.messagesDeleted += messageCount;

          const parts = conversationKey.replace(CONVERSATION_PREFIX, "").split(":");
          if (parts.length >= 2) {
            const configId = parts[0];
            const phoneNumber = parts.slice(1).join(":");

            const contactKey = `${CONVERSATION_CONTACT_PREFIX}${configId}:${phoneNumber}`;
            contactKeysToDelete.push(contactKey);

            const pauseKey = `${CONVERSATION_PAUSED_PREFIX}${configId}:${phoneNumber}`;
            keysToDelete.push(pauseKey);

            if (!phoneNumbersToRemoveFromSets.has(configId)) {
              phoneNumbersToRemoveFromSets.set(configId, []);
            }
            phoneNumbersToRemoveFromSets.get(configId).push(phoneNumber);
          }
        }
      } catch (error) {
        console.error(`Error procesando ${conversationKey}:`, error.message);
        stats.errors++;
      }
    }

    console.log("");
    console.log("=".repeat(60));
    console.log("RESUMEN DE LIMPIEZA");
    console.log("=".repeat(60));
    console.log(`Conversaciones a eliminar: ${keysToDelete.length}`);
    console.log(`Contactos a eliminar: ${contactKeysToDelete.length}`);
    console.log(`Mensajes totales a eliminar: ${stats.messagesDeleted}`);
    console.log("");

    if (keysToDelete.length === 0) {
      console.log("No hay conversaciones antiguas para eliminar.");
      return stats;
    }

    // 3. Eliminar las claves en lotes
    console.log("Eliminando claves...");

    const allKeysToDelete = [...keysToDelete, ...contactKeysToDelete];
    const BATCH_SIZE = 100;

    for (let i = 0; i < allKeysToDelete.length; i += BATCH_SIZE) {
      const batch = allKeysToDelete.slice(i, i + BATCH_SIZE);
      try {
        await redis.del(...batch);
        console.log(
          `  Eliminadas ${Math.min(i + BATCH_SIZE, allKeysToDelete.length)}/${allKeysToDelete.length} claves`
        );
      } catch (error) {
        console.error(`Error eliminando lote:`, error.message);
        stats.errors++;
      }
    }

    stats.conversationsDeleted = keysToDelete.length;
    stats.contactsDeleted = contactKeysToDelete.length;

    // 4. Remover números de teléfono de los sets de contactos
    console.log("\nLimpiando sets de contactos...");
    for (const [configId, phoneNumbers] of phoneNumbersToRemoveFromSets) {
      const setKey = `${CONVERSATION_CONTACTS_SET_PREFIX}${configId}`;
      try {
        if (phoneNumbers.length > 0) {
          await redis.srem(setKey, ...phoneNumbers);
          console.log(
            `  Removidos ${phoneNumbers.length} contactos del set ${configId}`
          );
        }
      } catch (error) {
        console.error(`Error removiendo del set ${setKey}:`, error.message);
        stats.errors++;
      }
    }

    console.log("");
    console.log("=".repeat(60));
    console.log("LIMPIEZA COMPLETADA");
    console.log("=".repeat(60));
    console.log(`Conversaciones eliminadas: ${stats.conversationsDeleted}`);
    console.log(`Contactos eliminados: ${stats.contactsDeleted}`);
    console.log(`Mensajes eliminados: ${stats.messagesDeleted}`);
    console.log(`Errores: ${stats.errors}`);
    console.log("");

    return stats;
  } catch (error) {
    console.error("Error fatal:", error.message);
    process.exit(1);
  }
}

// Ejecutar
cleanupOldConversations()
  .then((stats) => {
    console.log("Script finalizado.");
    process.exit(stats.errors > 0 ? 1 : 0);
  })
  .catch((error) => {
    console.error("Error fatal:", error);
    process.exit(1);
  });
