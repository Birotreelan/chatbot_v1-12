import { NextResponse } from "next/server"
import { requireAuthFromRequest } from "@/lib/auth"
import { getRedisClient } from "@/lib/redis"

/**
 * ── Esta escritura exige sesión (18/11/2026) ───────────────────────────────
 *
 * Segunda tanda de la auditoría: después de cerrar las lecturas críticas
 * quedaban 37 rutas que ESCRIBEN o MANDAN sin verificar nada. El middleware
 * hace CORS y la cookie del SSO, pero no autentica.
 *
 * Vacía la caché de configuraciones.
 *
 * La llama el dashboard desde el navegador, con la cookie de sesión: no hubo
 * que tocar ningún `fetch`.
 */
export async function POST(request: Request) {
  const { session: sesion, error: errorDeSesion } = await requireAuthFromRequest(request as Request)
  if (!sesion) {
    return NextResponse.json({ error: errorDeSesion || "No autorizado" }, { status: 401 })
  }


  try {
    const { configId } = await request.json()
    
    console.log("[CLEAR-CACHE] Intentando limpiar cache para configId:", configId)
    
    if (!configId) {
      return NextResponse.json({ error: "configId es requerido" }, { status: 400 })
    }

    const redisClient = getRedisClient()
    
    if (!redisClient) {
      console.error("[CLEAR-CACHE] Redis no disponible")
      return NextResponse.json({ error: "Redis no disponible" }, { status: 500 })
    }

    const cacheKey = `whatsapp_config:${configId}`
    
    console.log("[CLEAR-CACHE] Eliminando clave:", cacheKey)
    
    // Eliminar la clave de cache
    const result = await redisClient.del(cacheKey)
    
    console.log(`[CLEAR-CACHE] Resultado del delete: ${result}, Cache eliminado para config: ${configId}`)
    
    return NextResponse.json({ 
      success: true, 
      message: `Cache eliminado para ${configId}. Guarda la configuración nuevamente desde el panel.`,
      deleted: result
    })
  } catch (error) {
    console.error("[CLEAR-CACHE] Error:", error)
    return NextResponse.json({ 
      error: "Error al limpiar cache",
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
