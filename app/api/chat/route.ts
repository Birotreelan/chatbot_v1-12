import { type NextRequest, NextResponse } from "next/server"
import { processWebMessage } from "@/lib/web-chat-final"
import { getConfigByClienteId } from "@/lib/db"
import { rateLimit } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { message, cliente_id, session_id } = body

    console.log(`[CHAT API] ========== NUEVA SOLICITUD ==========`)
    console.log(`[CHAT API] Cliente ID: ${cliente_id}`)
    console.log(`[CHAT API] Session ID: ${session_id}`)
    console.log(`[CHAT API] Mensaje: ${message}`)
    console.log(`[CHAT API] =======================================`)

    // Validar parámetros requeridos
    if (!message || !cliente_id || !session_id) {
      console.error(`[CHAT API] ❌ Parámetros faltantes:`, {
        message: !!message,
        cliente_id: !!cliente_id,
        session_id: !!session_id,
      })
      return NextResponse.json(
        { error: "Faltan parámetros requeridos: message, cliente_id, session_id" },
        { status: 400 },
      )
    }

    // Obtener IP del cliente para rate limiting
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown"
    console.log(`[CHAT API] IP del cliente: ${ip}`)

    // Rate limiting por IP
    const rateLimitResult = await rateLimit(`chat_ip_${ip}`, 10) // 10 mensajes por minuto por IP
    if (!rateLimitResult.success) {
      console.warn(`[CHAT API] ⚠️ Rate limit excedido para IP: ${ip}`)
      return NextResponse.json(
        { error: "Demasiados mensajes. Por favor, espera un momento antes de enviar otro mensaje." },
        { status: 429 },
      )
    }

    // Buscar la configuración por cliente_id
    console.log(`[CHAT API] Buscando configuración para cliente_id: ${cliente_id}`)
    const config = await getConfigByClienteId(cliente_id)

    if (!config) {
      console.error(`[CHAT API] ❌ Configuración no encontrada para cliente_id: ${cliente_id}`)
      return NextResponse.json({ error: "Configuración no encontrada" }, { status: 404 })
    }

    // Verificar si el widget está habilitado
    if (config.widgetEnabled === false) {
      console.error(`[CHAT API] ❌ Widget deshabilitado para cliente_id: ${cliente_id}`)
      return NextResponse.json({ error: "Widget no habilitado" }, { status: 403 })
    }

    console.log(`[CHAT API] ✅ Configuración encontrada: ${config.displayName}`)
    console.log(`[CHAT API] Widget habilitado: ${config.widgetEnabled}`)
    console.log(`[CHAT API] Assistant ID: ${config.assistantId}`)

    // Procesar el mensaje
    console.log(`[CHAT API] Procesando mensaje...`)
    const response = await processWebMessage({
      message,
      sessionId: session_id,
      config,
      ip,
    })

    console.log(`[CHAT API] ✅ Respuesta generada: ${response.length} caracteres`)
    console.log(`[CHAT API] ========== SOLICITUD COMPLETADA ==========`)

    return NextResponse.json({
      response,
      success: true,
    })
  } catch (error) {
    console.error("[CHAT API] ❌ Error al procesar mensaje:", error)

    return NextResponse.json(
      {
        error: "Error interno del servidor",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}

export async function GET() {
  return NextResponse.json(
    {
      message: "Chat API funcionando",
      endpoints: {
        POST: "Enviar mensaje de chat",
      },
    },
    { status: 200 },
  )
}
