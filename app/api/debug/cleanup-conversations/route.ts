import { NextResponse } from "next/server"
import { getRedisClient } from "@/lib/redis"

async function cleanupConversations() {
  const redisClient = getRedisClient()
  if (!redisClient) {
    throw new Error("Redis no disponible")
  }

  console.log("[CLEANUP] 🧹 Iniciando limpieza de conversaciones corruptas")

  // Buscar todas las claves de conversation_list
  const listKeys = await redisClient.keys("conversation_list:*")
  console.log(`[CLEANUP] 📋 Encontradas ${listKeys.length} listas de conversaciones`)

  let cleanedCount = 0
  for (const listKey of listKeys) {
    console.log(`[CLEANUP] 🔍 Procesando: ${listKey}`)

    // Obtener todos los datos del hash
    const data = await redisClient.hgetall(listKey)

    if (!data || Object.keys(data).length === 0) {
      console.log(`[CLEANUP] ⚠️ Lista vacía, eliminando: ${listKey}`)
      await redisClient.del(listKey)
      continue
    }

    // Verificar cada entrada
    for (const [phoneNumber, value] of Object.entries(data)) {
      try {
        // Intentar parsear como JSON
        const parsed = JSON.parse(value as string)

        // Si no tiene la estructura correcta, eliminar
        if (!parsed.phoneNumber || !parsed.lastMessageAt) {
          console.log(`[CLEANUP] ❌ Entrada corrupta para ${phoneNumber}, eliminando`)
          await redisClient.hdel(listKey, phoneNumber)
          cleanedCount++
        }
      } catch (error) {
        // Si no es JSON válido, eliminar
        console.log(`[CLEANUP] ❌ JSON inválido para ${phoneNumber}, eliminando`)
        await redisClient.hdel(listKey, phoneNumber)
        cleanedCount++
      }
    }
  }

  // Buscar todas las claves de conversation (mensajes)
  const messageKeys = await redisClient.keys("conversation:*")
  console.log(`[CLEANUP] 📨 Encontradas ${messageKeys.length} conversaciones de mensajes`)

  console.log(`[CLEANUP] ✅ Limpieza completada: ${cleanedCount} entradas corruptas eliminadas`)

  return {
    success: true,
    cleanedEntries: cleanedCount,
    listKeys: listKeys.length,
    messageKeys: messageKeys.length,
  }
}

export async function GET() {
  try {
    const result = await cleanupConversations()
    return NextResponse.json(result)
  } catch (error) {
    console.error("[CLEANUP] ❌ Error en limpieza:", error)
    return NextResponse.json({ error: "Error en limpieza" }, { status: 500 })
  }
}

export async function POST() {
  try {
    const result = await cleanupConversations()
    return NextResponse.json(result)
  } catch (error) {
    console.error("[CLEANUP] ❌ Error en limpieza:", error)
    return NextResponse.json({ error: "Error en limpieza" }, { status: 500 })
  }
}
