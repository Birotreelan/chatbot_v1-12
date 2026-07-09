import { type NextRequest, NextResponse } from "next/server"
import { processWidgetMessage } from "@/lib/conversation-state/widget/widget-chat-flow"
import { getWhatsappConfigByClienteId } from "@/lib/db"

/**
 * Endpoint del widget embebible (chat en el sitio web de cada clínica).
 *
 * Desde el 9/7/2026 usa el mismo motor de agendamiento que WhatsApp
 * (lib/conversation-state/widget/widget-chat-flow.ts), no el pipeline legacy de
 * OpenAI Assistants (lib/web-chat-final.ts, que queda sin usar). El widget SOLO
 * agenda turnos nuevos — ver reglas de producto en widget-chat-flow.ts.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { message, cliente_id, session_id } = body

    if (!message || !cliente_id || !session_id) {
      return NextResponse.json(
        {
          success: false,
          error: "Parámetros requeridos faltantes",
          missing: { message: !message, cliente_id: !cliente_id, session_id: !session_id },
        },
        { status: 400 },
      )
    }

    const config = await getWhatsappConfigByClienteId(cliente_id)
    if (!config) {
      console.log("[API-CHAT] Configuración no encontrada para cliente_id:", cliente_id)
      return NextResponse.json(
        { success: false, error: "Configuración no encontrada" },
        { status: 404 },
      )
    }

    if (config.widgetEnabled === false) {
      return NextResponse.json({
        success: true,
        response: "Este servicio no está disponible por el momento.",
      })
    }

    const result = await processWidgetMessage(session_id, message, config.cliente_id, config.escalationPhoneNumber)

    return NextResponse.json({ success: true, response: result.message })
  } catch (error) {
    console.error("[API-CHAT] Error procesando solicitud:", error)
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
