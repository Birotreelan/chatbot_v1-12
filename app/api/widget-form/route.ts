import { type NextRequest, NextResponse } from "next/server"
import { processWidgetFormMessage } from "@/lib/conversation-state/widget/widget-form-flow"
import { getWhatsappConfigByClienteId } from "@/lib/db"

/**
 * Endpoint del widget de FORMULARIO (tercer tipo de widget embebible, 9/7/2026).
 *
 * Hermano de /api/chat (usado por el widget de chat) — misma validación de
 * cliente/config, mismo motor de agendamiento por debajo
 * (lib/conversation-state/widget/widget-form-flow.ts), pero la respuesta es
 * un "paso" estructurado (fase, tipo de control, opciones/turnos) en vez de
 * un mensaje de texto plano.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { message, cliente_id, session_id, init } = body

    if (!cliente_id || !session_id || (!init && typeof message !== "string")) {
      return NextResponse.json(
        {
          success: false,
          error: "Parámetros requeridos faltantes",
          missing: { cliente_id: !cliente_id, session_id: !session_id, message: !init && typeof message !== "string" },
        },
        { status: 400 },
      )
    }

    const config = await getWhatsappConfigByClienteId(cliente_id)
    if (!config) {
      console.log("[API-WIDGET-FORM] Configuración no encontrada para cliente_id:", cliente_id)
      return NextResponse.json({ success: false, error: "Configuración no encontrada" }, { status: 404 })
    }

    if (config.widgetEnabled === false) {
      return NextResponse.json({
        success: true,
        step: {
          phase: "error",
          done: true,
          success: false,
          message: "Este servicio no está disponible por el momento.",
          inputType: "info",
        },
      })
    }

    const step = await processWidgetFormMessage(
      session_id,
      typeof message === "string" ? message : "",
      config.cliente_id,
      config.escalationPhoneNumber,
      init === true,
    )

    return NextResponse.json({ success: true, step })
  } catch (error) {
    console.error("[API-WIDGET-FORM] Error procesando solicitud:", error)
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
