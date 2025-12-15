import { NextResponse } from "next/server"
import { Redis } from "@upstash/redis"

export async function POST() {
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
