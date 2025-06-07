import { type NextRequest, NextResponse } from "next/server"
import { getConfigByClienteId } from "@/lib/db"
import { processWebMessage } from "@/lib/web-chat"
import { rateLimit } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    // Aplicar rate limiting
    const ip = request.headers.get("x-forwarded-for") || "unknown"
    const rateLimitResult = await rateLimit(`web_${ip}`, 10) // 10 mensajes por minuto

    if (!rateLimitResult.success) {
      return new NextResponse(
        JSON.stringify({
          error: "Demasiadas solicitudes. Por favor, intenta de nuevo más tarde.",
          retryAfter: rateLimitResult.retryAfter,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(rateLimitResult.retryAfter || 60),
          },
        },
      )
    }

    // Obtener datos del cuerpo de la solicitud
    const { message, cliente_id, session_id } = await request.json()

    // Validar datos
    if (!message || !cliente_id || !session_id) {
      return new NextResponse(
        JSON.stringify({
          error: "Se requieren los campos message, cliente_id y session_id",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      )
    }

    // Buscar la configuración por cliente_id
    const config = await getConfigByClienteId(cliente_id)

    if (!config) {
      return new NextResponse(
        JSON.stringify({
          error: "Configuración no encontrada para el cliente_id proporcionado",
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      )
    }

    // Verificar si el widget está habilitado
    if (!config.widgetEnabled) {
      return new NextResponse(
        JSON.stringify({
          error: "El widget no está habilitado para este cliente",
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      )
    }

    // Procesar el mensaje
    const response = await processWebMessage({
      message,
      sessionId: session_id,
      config,
      ip,
    })

    // Devolver la respuesta
    return new NextResponse(
      JSON.stringify({
        response,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    )
  } catch (error) {
    console.error("Error al procesar mensaje del chat:", error)

    return new NextResponse(
      JSON.stringify({
        error: "Error interno del servidor",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    )
  }
}
