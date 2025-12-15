import { NextResponse } from "next/server"
import { configureAssistant } from "@/lib/assistant-config"
import { getRedisClient } from "@/lib/redis"

export async function POST() {
  try {
    // 1. Actualizar asistente con nuevas instrucciones
    const assistantId = await configureAssistant()

    // 2. Eliminar todos los threads existentes
    const redis = getRedisClient()
    let threadsDeleted = 0

    if (redis) {
      const threadKeys = await redis.keys("thread:*")

      if (threadKeys.length > 0) {
        await Promise.all(threadKeys.map((key) => redis.del(key)))
        threadsDeleted = threadKeys.length
      }
    }

    return NextResponse.json({
      success: true,
      message: "Asistente actualizado y threads eliminados correctamente",
      assistantId,
      threadsDeleted,
    })
  } catch (error) {
    console.error("Error al resetear sistema:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido al resetear sistema",
      },
      { status: 500 },
    )
  }
}
