import { NextResponse } from "next/server"
import { getRedisClient } from "@/lib/db"

export async function POST(request: Request) {
  try {
    const { configId } = await request.json()
    
    if (!configId) {
      return NextResponse.json({ error: "configId es requerido" }, { status: 400 })
    }

    const redisClient = getRedisClient()
    
    if (!redisClient) {
      return NextResponse.json({ error: "Redis no disponible" }, { status: 500 })
    }

    const cacheKey = `whatsapp_config:${configId}`
    
    // Eliminar la clave de cache
    await redisClient.del(cacheKey)
    
    console.log(`[CLEAR-CACHE] Cache eliminado para config: ${configId}`)
    
    return NextResponse.json({ 
      success: true, 
      message: `Cache eliminado para ${configId}. Guarda la configuración nuevamente desde el panel.` 
    })
  } catch (error) {
    console.error("[CLEAR-CACHE] Error:", error)
    return NextResponse.json({ error: "Error al limpiar cache" }, { status: 500 })
  }
}
