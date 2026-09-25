/**
 * Cancelar el turno, o confirmar que se va a asistir (25/9/2026).
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 *
 * Con el cobro por mensaje, la cancelación por chat cuesta cuatro: el
 * recordatorio, el "confirmá tu decisión", el "cancelado, ¿querés reagendar?"
 * y el flujo de turnos si dice que sí. El paso de confirmación existe por un
 * buen motivo —evitar cancelaciones accidentales— pero no tiene por qué ser un
 * mensaje: en una pantalla es gratis.
 *
 * Así que el bot manda UN enlace y todo lo demás pasa acá.
 *
 * ── Hermana de `gestionar`, no su reemplazo ────────────────────────────────
 *
 * `gestionar` reserva (y cancela el anterior si corresponde). Esta cancela sin
 * reservar nada, o confirma la asistencia. Son operaciones distintas sobre el
 * mismo turno y comparten las mismas reglas: la autorización es el token, el
 * enlace se consume una sola vez, y un enlace de prueba no toca ninguna
 * agenda.
 */

import { NextResponse } from "next/server"
import { leerEnlace, consumirEnlace } from "@/lib/portal/token"
import { permiteGestionar } from "@/lib/portal/vigencia"
import { cancelarTurno, confirmarTurno } from "@/lib/api-tools/api-functions"
import { saveConversationMessage } from "@/lib/conversations"
import { clearAppointmentContext } from "@/lib/appointment-flow-state"
import { trackAppointmentEvent } from "@/lib/appointment-stats"
import { nanoid } from "nanoid"

export const runtime = "nodejs"

export async function POST(request: Request) {
  let cuerpo: any
  try {
    cuerpo = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 })
  }

  const token = String(cuerpo.token || "")
  const accion = cuerpo.accion === "confirmar" ? "confirmar" : "cancelar"
  if (!token) return NextResponse.json({ ok: false, error: "Faltan datos" }, { status: 400 })

  const lectura = await leerEnlace(token)
  if (!lectura) {
    return NextResponse.json({ ok: false, error: "Este enlace ya no está disponible." }, { status: 404 })
  }

  const { contexto, estado } = lectura

  if (!permiteGestionar(estado)) {
    return NextResponse.json(
      {
        ok: false,
        yaGestionado: estado === "gestionado",
        error:
          estado === "gestionado"
            ? contexto.resultado?.texto || "Esta gestión ya se hizo."
            : "El plazo para gestionar por acá terminó. Escribinos por WhatsApp.",
      },
      { status: 409 },
    )
  }

  if (!contexto.clienteId) {
    return NextResponse.json({ ok: false, error: "Configuración incompleta" }, { status: 500 })
  }

  const dni = contexto.identidad?.dni || contexto.pacienteDNI
  const fecha = contexto.turno?.fecha

  // Sin fecha y DNI no se puede identificar el turno: `cancelar_turno` y
  // `confirmar_turno` los piden a los dos. Antes de mandar una llamada que va
  // a fallar, se lo decimos.
  if (!fecha || !dni) {
    console.error(`[PORTAL] ${accion}: falta fecha o DNI para ${contexto.phone}`)
    return NextResponse.json(
      { ok: false, error: "No pudimos identificar tu turno. Escribinos por WhatsApp y lo resolvemos." },
      { status: 400 },
    )
  }

  const cuando = [contexto.turno?.fechaFormateada, contexto.turno?.horaFormateada]
    .filter(Boolean)
    .join(" a las ")

  // ── Enlace de prueba: se recorre todo, no se toca nada ────────────────────
  //
  // Corta ANTES de la llamada al proxy, por el mismo motivo que en `gestionar`:
  // que un refactor no pueda mover la llamada por encima del corte.
  if (contexto.demo) {
    const textoDemo =
      accion === "cancelar"
        ? `Cancelamos tu turno${cuando ? ` del ${cuando}` : ""}.`
        : `Confirmamos tu asistencia${cuando ? ` al turno del ${cuando}` : ""}.`
    await consumirEnlace(token, { texto: textoDemo, turno: contexto.turno })
    console.log(`[PORTAL] Enlace de PRUEBA: ${accion} simulado, no se tocó ninguna agenda (${contexto.phone})`)
    return NextResponse.json({ ok: true, demo: true, accion, texto: textoDemo })
  }

  // ── La operación real ─────────────────────────────────────────────────────
  let resultado: any
  try {
    resultado =
      accion === "cancelar"
        ? await cancelarTurno(contexto.clienteId, {
            fecha,
            motivo: "Cancelado por el paciente desde el portal",
            paciente_datos: { dni, telefono: contexto.phone },
          })
        : await confirmarTurno(contexto.clienteId, {
            fecha,
            paciente_datos: { dni, telefono: contexto.phone },
          })
  } catch (error) {
    console.error(`[PORTAL] Error al ${accion} el turno:`, error)
    return NextResponse.json(
      { ok: false, error: "No pudimos completar la gestión. Probá de nuevo o escribinos por WhatsApp." },
      { status: 502 },
    )
  }

  if (resultado && resultado.exito === false) {
    console.warn(`[PORTAL] El proxy rechazó ${accion}:`, JSON.stringify(resultado)?.slice(0, 400))
    return NextResponse.json(
      { ok: false, error: "No pudimos completar la gestión. Escribinos por WhatsApp y lo resolvemos." },
      { status: 409 },
    )
  }

  const texto =
    accion === "cancelar"
      ? `Cancelamos tu turno${cuando ? ` del ${cuando}` : ""}.`
      : `Confirmamos tu asistencia${cuando ? ` al turno del ${cuando}` : ""}.`

  await consumirEnlace(token, { texto, turno: contexto.turno })

  // Las estadísticas, con el mismo criterio que el resto del sistema: sin
  // esto, las cancelaciones hechas por el portal no existirían en
  // /dashboard/estadisticas y la clínica vería caer un número que en realidad
  // sólo cambió de canal.
  try {
    await trackAppointmentEvent({
      clienteId: contexto.clienteId,
      phoneNumber: contexto.phone,
      eventType: accion === "cancelar" ? "cancelled" : "confirmed",
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("[PORTAL] No se pudo registrar la estadística:", error)
  }

  // El bot y el panel tienen que enterarse: sin esto, un agente abre la
  // conversación y ve que el paciente recibió un enlace y desapareció.
  try {
    await saveConversationMessage({
      id: nanoid(),
      role: "assistant",
      content: `[Portal] ${texto}`,
      timestamp: new Date().toISOString(),
      phoneNumber: contexto.phone,
      configId: contexto.configId,
      messageType: "portal",
    })
    // El contexto de turnos que tenía el bot quedó viejo en este instante.
    await clearAppointmentContext(contexto.phone, contexto.configId)
  } catch (error) {
    console.error("[PORTAL] No se pudo registrar en la conversación:", error)
  }

  return NextResponse.json({ ok: true, accion, texto })
}
