import { type NextRequest, NextResponse } from "next/server"
import { processWidgetMessage } from "@/lib/conversation-state/widget/widget-chat-flow"
import { getWhatsappConfigByClienteId } from "@/lib/db"
import { rateLimit } from "@/lib/rate-limit"
import { looksLikeDNI, checkDniRateLimit, DNI_RATE_LIMIT_MESSAGE } from "@/lib/dni-rate-limit"
import { isWidgetOriginAllowed } from "@/lib/widget-domain-validation"
import { hasReachedReservationLimit, recordReservation, RESERVATION_LIMIT_MESSAGE } from "@/lib/reservation-limit"

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
    const ip = request.headers.get("x-forwarded-for") || "unknown"
    // Mismo motor que el widget-form (incluye búsqueda de pacientes por DNI):
    // límite más estricto que el default para dificultar la enumeración y
    // acotar el costo de OpenAI ante abuso.
    const rateLimitResult = await rateLimit(`chat:ip:${ip}`, 20, 60000)
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { success: false, error: "Demasiadas solicitudes. Probá de nuevo en unos minutos." },
        { status: 429 },
      )
    }

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

    if (!isWidgetOriginAllowed(config, request)) {
      console.warn("[API-CHAT] Origen no autorizado para cliente_id:", cliente_id)
      return NextResponse.json({ success: false, error: "Origen no autorizado" }, { status: 403 })
    }

    if (looksLikeDNI(message) && !(await checkDniRateLimit(ip))) {
      return NextResponse.json({ success: true, response: DNI_RATE_LIMIT_MESSAGE })
    }

    if (config.widgetEnabled === false) {
      return NextResponse.json({
        success: true,
        response: "Este servicio no está disponible por el momento.",
      })
    }

    // Tope de RESERVAS COMPLETADAS por IP (no de mensajes): evita que una
    // persona o un bot llene la agenda reservando turno tras turno.
    if (await hasReachedReservationLimit(ip)) {
      return NextResponse.json({ success: true, response: RESERVATION_LIMIT_MESSAGE })
    }

    const result = await processWidgetMessage(session_id, message, config.cliente_id, config.escalationPhoneNumber)

    if (result.reserved) {
      await recordReservation(ip)
    }

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
