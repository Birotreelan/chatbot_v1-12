import { type NextRequest, NextResponse } from "next/server"
import { clearAllCaches, clearConfigCache } from "@/lib/db"
import { logger } from "@/lib/logger"

export async function POST(request: NextRequest) {
  try {
    logger.apiStart("/cache/clear", "POST")

    const body = await request.json().catch(() => ({}))
    const { configId } = body

    if (configId) {
      // Clear cache for specific config
      clearConfigCache(configId)
      logger.info("API", `Caché limpiado para config: ${configId}`)
      return NextResponse.json({
        success: true,
        message: `Caché limpiado para configuración ${configId}`,
      })
    } else {
      // Clear all caches
      clearAllCaches()
      logger.info("API", "Todos los cachés limpiados")
      return NextResponse.json({
        success: true,
        message: "Todos los cachés limpiados exitosamente",
      })
    }
  } catch (error) {
    logger.apiError("/cache/clear", "POST", error)
    return NextResponse.json({ error: "Error al limpiar caché" }, { status: 500 })
  }
}
