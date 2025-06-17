import { type NextRequest, NextResponse } from "next/server"
import { processWebChatMessage } from "@/lib/web-chat-final"
import { getWhatsappConfigByClienteId } from "@/lib/db"

export async function POST(request: NextRequest) {
  console.log("[API-CHAT] 🚀 === NUEVA PETICIÓN DE CHAT ===")
  console.log("[API-CHAT] 📅 Timestamp:", new Date().toISOString())
  console.log("[API-CHAT] 🌐 URL:", request.url)
  console.log("[API-CHAT] 📋 Headers:", Object.fromEntries(request.headers.entries()))

  try {
    const body = await request.json()
    console.log("[API-CHAT] 📦 Body completo recibido:", JSON.stringify(body, null, 2))

    const { message, cliente_id, session_id, source } = body

    console.log("[API-CHAT] 🔍 Parámetros extraídos:")
    console.log("[API-CHAT] - message:", message)
    console.log("[API-CHAT] - cliente_id:", cliente_id)
    console.log("[API-CHAT] - session_id:", session_id)
    console.log("[API-CHAT] - source:", source)

    // Validar parámetros requeridos
    const missingParams = {
      message: !message,
      cliente_id: !cliente_id,
      session_id: !session_id,
    }

    if (missingParams.message || missingParams.cliente_id || missingParams.session_id) {
      console.log("[API-CHAT] ❌ Parámetros faltantes:", missingParams)
      return NextResponse.json(
        {
          success: false,
          error: "Parámetros requeridos faltantes",
          missing: missingParams,
        },
        { status: 400 },
      )
    }

    console.log("[API-CHAT] ✅ Validaciones pasadas, buscando configuración...")

    // Obtener configuración del cliente
    const config = await getWhatsappConfigByClienteId(cliente_id)
    if (!config) {
      console.log("[API-CHAT] ❌ Configuración no encontrada para cliente_id:", cliente_id)
      return NextResponse.json(
        {
          success: false,
          error: "Configuración no encontrada",
        },
        { status: 404 },
      )
    }

    console.log("[API-CHAT] ✅ Configuración encontrada:", config.displayName)

    // Procesar mensaje con web chat
    console.log("[API-CHAT] 🤖 Procesando mensaje con web chat...")
    const response = await processWebChatMessage({
      message,
      sessionId: session_id,
      config,
      ip: request.ip || "unknown",
    })

    console.log("[API-CHAT] ✅ Respuesta generada:", response.length, "caracteres")
    console.log("[API-CHAT] 📄 Respuesta completa:", response)

    return NextResponse.json({
      success: true,
      response: response,
    })
  } catch (error) {
    console.error("[API-CHAT] 💥 Error procesando solicitud:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Error interno del servidor",
        details: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}
