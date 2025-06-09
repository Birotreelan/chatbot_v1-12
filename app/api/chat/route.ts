import { type NextRequest, NextResponse } from "next/server"
import { processWebChatMessage } from "@/lib/web-chat-final"
import { getWhatsappConfigByClienteId } from "@/lib/db"

export async function POST(request: NextRequest) {
  try {
    console.log("[CHAT API] ========== NUEVA SOLICITUD ==========")

    const body = await request.json()
    const { message, cliente_id, session_id, source } = body

    console.log("[CHAT API] Cliente ID:", cliente_id)
    console.log("[CHAT API] Session ID:", session_id)
    console.log("[CHAT API] Mensaje:", message)
    console.log("[CHAT API] Source:", source)
    console.log("[CHAT API] =======================================")

    // Validar parámetros requeridos
    const missingParams = {
      message: !message,
      cliente_id: !cliente_id,
      session_id: !session_id,
    }

    if (missingParams.message || missingParams.cliente_id || missingParams.session_id) {
      console.log("[CHAT API] ❌ Parámetros faltantes:", missingParams)
      return NextResponse.json(
        {
          success: false,
          error: "Parámetros requeridos faltantes",
          missing: missingParams,
        },
        { status: 400 },
      )
    }

    // Obtener configuración del cliente
    const config = await getWhatsappConfigByClienteId(cliente_id)
    if (!config) {
      console.log("[CHAT API] ❌ Configuración no encontrada para cliente_id:", cliente_id)
      return NextResponse.json(
        {
          success: false,
          error: "Configuración no encontrada",
        },
        { status: 404 },
      )
    }

    console.log("[CHAT API] ✅ Configuración encontrada:", config.displayName)

    // Procesar mensaje con web chat
    const response = await processWebChatMessage({
      message,
      sessionId: session_id,
      config,
      ip: request.ip || "unknown",
    })

    console.log("[CHAT API] ✅ Respuesta generada:", response.length, "caracteres")

    return NextResponse.json({
      success: true,
      response: response,
    })
  } catch (error) {
    console.error("[CHAT API] ❌ Error procesando solicitud:", error)
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
