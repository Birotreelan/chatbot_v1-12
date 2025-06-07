import { type NextRequest, NextResponse } from "next/server"
import { getWhatsAppConfig } from "@/lib/db"
import { processWebMessage } from "@/lib/web-chat"
import { rateLimit } from "@/lib/rate-limit"
import { incrementMetric } from "@/lib/monitoring"

export async function POST(req: NextRequest) {
  try {
    // Obtener IP para rate limiting
    const ip = req.headers.get("x-forwarded-for") || "unknown"

    // Aplicar rate limiting
    const rateLimitResult = await rateLimit(`web:${ip}`, 20, 60000) // 20 mensajes por minuto

    if (!rateLimitResult.success) {
      await incrementMetric("web_rate_limited")
      return NextResponse.json(
        { error: "Demasiadas solicitudes. Por favor, intenta de nuevo más tarde." },
        { status: 429 },
      )
    }

    // Parsear el cuerpo de la solicitud
    const body = await req.json()
    const { message, sessionId, configId } = body

    if (!message || !sessionId || !configId) {
      return NextResponse.json({ error: "Faltan parámetros requeridos" }, { status: 400 })
    }

    // Obtener la configuración
    const config = await getWhatsAppConfig(configId)

    if (!config || !config.active) {
      return NextResponse.json({ error: "Configuración no encontrada o inactiva" }, { status: 404 })
    }

    // Procesar el mensaje
    const response = await processWebMessage(message, sessionId, config)

    return NextResponse.json({ message: response })
  } catch (error) {
    console.error("[WEB-CHAT] Error en API de chat:", error)
    return NextResponse.json({ error: "Error al procesar el mensaje" }, { status: 500 })
  }
}
