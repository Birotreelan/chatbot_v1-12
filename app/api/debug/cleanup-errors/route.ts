import { NextResponse } from "next/server"
import { requireAuthForApi } from "@/lib/auth"
import { Redis } from "@upstash/redis"

/**
 * ── Esta escritura exige sesión (18/11/2026) ───────────────────────────────
 *
 * Segunda tanda de la auditoría: después de cerrar las lecturas críticas
 * quedaban 37 rutas que ESCRIBEN o MANDAN sin verificar nada. El middleware
 * hace CORS y la cookie del SSO, pero no autentica.
 *
 * Borra el registro de errores.
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
    const redis = Redis.fromEnv()

    // Obtener todas las claves de errores
    const errorKeys = await redis.keys("errors:*")

    let cleanedCount = 0
    let totalCount = 0

    for (const key of errorKeys) {
      // Obtener todos los errores de esta categoría
      const errors = await redis.lrange(key, 0, -1)
      totalCount += errors.length

      // Filtrar errores válidos
      const validErrors = []

      for (const error of errors) {
        try {
          JSON.parse(error as string)
          validErrors.push(error)
        } catch (e) {
          cleanedCount++
          console.log(`Eliminando error corrupto: ${error}`)
        }
      }

      // Reemplazar la lista con solo errores válidos
      if (validErrors.length > 0) {
        await redis.del(key)
        await redis.lpush(key, ...validErrors)
      } else {
        await redis.del(key)
      }
    }

    return NextResponse.json({
      success: true,
      message: `Limpieza completada. ${cleanedCount} errores corruptos eliminados de ${totalCount} totales.`,
      cleanedCount,
      totalCount,
    })
  } catch (error) {
    console.error("Error al limpiar errores:", error)
    return NextResponse.json({ success: false, error: "Error al limpiar errores" }, { status: 500 })
  }
}
