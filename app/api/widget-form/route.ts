import { type NextRequest, NextResponse } from "next/server"
import { processWidgetFormMessage } from "@/lib/conversation-state/widget/widget-form-flow"
import { getWhatsappConfigByClienteId } from "@/lib/db"
import { rateLimit } from "@/lib/rate-limit"
import { looksLikeDNI, checkDniRateLimit, DNI_RATE_LIMIT_MESSAGE } from "@/lib/dni-rate-limit"
import { isWidgetOriginAllowed } from "@/lib/widget-domain-validation"
import { hasReachedReservationLimit, recordReservation, RESERVATION_LIMIT_MESSAGE } from "@/lib/reservation-limit"
import { verifyTurnstileToken } from "@/lib/turnstile"
import { markAwaitingConfirmation, isAwaitingConfirmation, clearAwaitingConfirmation } from "@/lib/widget-confirmation-gate"

// Mismas palabras que reconoce como "sí" el motor compartido
// (lib/conversation-state/shared/confirmation-handler.ts). Sólo cuando el
// mensaje tiene forma de "confirmar" exigimos el CAPTCHA — "No, modificar"
// (u otra cosa) puede seguir de largo sin verificación, porque no ejecuta
// ninguna reserva.
const POSITIVE_CONFIRMATION_WORDS = ["si", "sí", "yes", "confirmo", "confirmar", "ok", "dale", "bueno", "perfecto", "1"]
function looksLikeConfirmAttempt(msg: string): boolean {
  const normalized = msg.trim().toLowerCase()
  return POSITIVE_CONFIRMATION_WORDS.some((w) => normalized.includes(w))
}

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
    const ip = request.headers.get("x-forwarded-for") || "unknown"
    // Endpoint público sensible (incluye búsqueda de pacientes por DNI):
    // límite más estricto que el default para dificultar la enumeración.
    const rateLimitResult = await rateLimit(`widget-form:ip:${ip}`, 20, 60000)
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { success: false, error: "Demasiadas solicitudes. Probá de nuevo en unos minutos." },
        { status: 429 },
      )
    }

    const body = await request.json()
    const { message, cliente_id, session_id, init, turnstileToken } = body

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

    if (!isWidgetOriginAllowed(config, request)) {
      console.warn("[API-WIDGET-FORM] Origen no autorizado para cliente_id:", cliente_id)
      return NextResponse.json({ success: false, error: "Origen no autorizado" }, { status: 403 })
    }

    // Tope de RESERVAS COMPLETADAS por IP (no de mensajes): evita que una
    // persona o un bot llene la agenda reservando turno tras turno.
    if (await hasReachedReservationLimit(ip)) {
      return NextResponse.json({
        success: true,
        step: {
          phase: "error",
          done: true,
          success: false,
          message: RESERVATION_LIMIT_MESSAGE,
          inputType: "info",
        },
      })
    }

    // CAPTCHA (Turnstile) obligatorio para responder al paso de confirmación
    // de reserva — el mismo que exigimos por marca del lado del servidor
    // (no alcanza con que el frontend "diga" que mandó un token: si el
    // paso previamente enviado a esta sesión fue de confirmación, no se
    // avanza sin un token válido).
    if (
      typeof message === "string" &&
      looksLikeConfirmAttempt(message) &&
      (await isAwaitingConfirmation(session_id))
    ) {
      const verified = await verifyTurnstileToken(turnstileToken, ip, config.widgetTurnstileSecret)
      if (!verified) {
        // Reenviamos un mensaje "vacío" al motor: no matchea ni sí ni no, así
        // que re-muestra el paso de confirmación (con el resumen y las
        // opciones intactas) SIN ejecutar la reserva — mismo camino que ya
        // usa el motor para "no entendí tu respuesta".
        const retryStep = await processWidgetFormMessage(
          session_id,
          "",
          config.cliente_id,
          config.escalationPhoneNumber,
          false,
          config.permitirNuevoTurno,
        )
        retryStep.alert = {
          type: "warning",
          message: 'Antes de confirmar, completá la verificación ("No soy un robot") y volvé a intentar.',
        }
        retryStep.turnstileSiteKey = config.widgetTurnstileSiteKey
        return NextResponse.json({ success: true, step: retryStep })
      }
      await clearAwaitingConfirmation(session_id)
    }

    if (typeof message === "string" && looksLikeDNI(message) && !(await checkDniRateLimit(ip))) {
      return NextResponse.json({
        success: true,
        step: {
          phase: "awaiting_dni",
          done: false,
          success: false,
          message: DNI_RATE_LIMIT_MESSAGE,
          inputType: "dni",
        },
      })
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
      config.permitirNuevoTurno,
    )

    if (step.phase === "completed" && step.success) {
      await recordReservation(ip)
    }

    if (step.inputType === "confirmation") {
      await markAwaitingConfirmation(session_id)
      step.turnstileSiteKey = config.widgetTurnstileSiteKey
    }

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
