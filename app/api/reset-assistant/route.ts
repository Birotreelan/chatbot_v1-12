import { NextResponse } from "next/server"
import { requireAuthForApi } from "@/lib/auth"
import { configureAssistant } from "@/lib/assistant-config"
import { getRedisClient } from "@/lib/redis"

/**
 * ── Esta escritura exige sesión (18/11/2026) ───────────────────────────────
 *
 * Segunda tanda de la auditoría: después de cerrar las lecturas críticas
 * quedaban 37 rutas que ESCRIBEN o MANDAN sin verificar nada. El middleware
 * hace CORS y la cookie del SSO, pero no autentica.
 *
 * Reescribe las instrucciones del asistente y borra todos los hilos.
 *
 * La llama el dashboard desde el navegador, con la cookie de sesión: no hubo
 * que tocar ningún `fetch`.
 */
export async function POST() {
  const { session: sesion, error: errorDeSesion } = await requireAuthForApi()
  if (!sesion) {
    return NextResponse.json({ error: errorDeSesion || "No autorizado" }, { status: 401 })
  }


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
