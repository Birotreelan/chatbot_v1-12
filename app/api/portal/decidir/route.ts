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
import { anotarEnElMonitor, etiquetaDelDesenlace } from "@/lib/portal/monitor"
import { leerEnlace, consumirEnlace } from "@/lib/portal/token"
import { permiteGestionar } from "@/lib/portal/vigencia"
import { cancelarTurno, confirmarTurno } from "@/lib/api-tools/api-functions"
import { estadoDeLaCancelacion, mensajeTurnoYaCancelado } from "@/lib/cancelacion-de-turno"
import { portalPuede, mensajeDeGestionNoDisponible } from "@/lib/portal/permisos"
import { clearAppointmentContext } from "@/lib/appointment-flow-state"
import { trackAppointmentEvent } from "@/lib/appointment-stats"
import { marcarCancelacion } from "@/lib/portal/cancelacion-reciente"

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
    await consumirEnlace(token, {
      texto: textoDemo,
      turno: contexto.turno,
      tipo: accion === "cancelar" ? "cancelacion" : "confirmacion",
    })
    console.log(`[PORTAL] Enlace de PRUEBA: ${accion} simulado, no se tocó ninguna agenda (${contexto.phone})`)
    return NextResponse.json({ ok: true, demo: true, accion, texto: textoDemo })
  }

  /**
   * ── Cancelar también es una gestión que el cliente puede apagar
   *    (24/11/2026) ──────────────────────────────────────────────────────────
   *
   * Esta ruta no leía `permitirCancelacion`, igual que `gestionar` no leía
   * `permitirNuevoTurno`. Ver lib/portal/permisos.ts: el chequeo existía en los
   * flujos de WhatsApp y en ninguno del portal.
   *
   * Confirmar no se toca: no hay switch para eso y no tendría sentido —confirmar
   * la asistencia no cambia nada en la agenda más que el estado del turno que la
   * clínica ya dio—.
   */
  if (accion === "cancelar") {
    const permiso = await portalPuede(contexto.configId, {
      intencion: contexto.intencion,
      gestion: "cancelar",
    })
    if (!permiso.permitido) {
      console.warn(
        `[PORTAL] Cancelación rechazada para ${contexto.phone}: el cliente ${contexto.clienteId} ` +
          `tiene permitirCancelacion desactivado`,
      )
      return NextResponse.json(
        { ok: false, error: mensajeDeGestionNoDisponible("cancelar", permiso.telefonoDeLaClinica) },
        { status: 403 },
      )
    }
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

  /**
   * ── La cancelación se leía por el campo equivocado (24/11/2026) ──────────
   *
   * `resultado.exito === false` sirve para `confirmarTurno`, que devuelve
   * `exito`. `cancelarTurno` devuelve el cuerpo del proxy tal cual, que trae
   * `success` — así que esta comparación nunca daba true y una cancelación
   * rechazada se le reportaba al paciente como hecha. `estadoDeLaCancelacion`
   * lee las dos formas; ver la nota de ese módulo.
   *
   * Y un turno que ya no estaba en la agenda no es un rechazo: el paciente
   * pidió que ese turno no exista y no existe. Se cierra bien, con el texto
   * que lo dice.
   */
  let yaEstabaCancelado = false
  if (accion === "cancelar") {
    const estado = estadoDeLaCancelacion(resultado, { httpOk: true })
    yaEstabaCancelado = estado === "ya_no_estaba"
    if (estado === "falla_tecnica") {
      console.warn(`[PORTAL] El proxy rechazó la cancelación:`, JSON.stringify(resultado)?.slice(0, 400))
      return NextResponse.json(
        { ok: false, error: "No pudimos completar la gestión. Escribinos por WhatsApp y lo resolvemos." },
        { status: 409 },
      )
    }
  } else if (resultado && resultado.exito === false) {
    console.warn(`[PORTAL] El proxy rechazó ${accion}:`, JSON.stringify(resultado)?.slice(0, 400))
    return NextResponse.json(
      { ok: false, error: "No pudimos completar la gestión. Escribinos por WhatsApp y lo resolvemos." },
      { status: 409 },
    )
  }

  const texto =
    accion === "cancelar"
      ? yaEstabaCancelado
        ? mensajeTurnoYaCancelado(cuando)
        : `Cancelamos tu turno${cuando ? ` del ${cuando}` : ""}.`
      : `Confirmamos tu asistencia${cuando ? ` al turno del ${cuando}` : ""}.`

  await consumirEnlace(token, {
    texto,
    turno: contexto.turno,
    tipo: accion === "cancelar" ? "cancelacion" : "confirmacion",
  })

  // ── El rastro de la cancelación ───────────────────────────────────────────
  //
  // Los botones del recordatorio siguen tocables. Sin esto, tocar "Confirmar
  // asistencia" después de cancelar devolvía "Hubo un problema, intentá de
  // nuevo" — un callejón sin salida, porque el turno no va a volver.
  if (accion === "cancelar") {
    await marcarCancelacion(contexto.configId, contexto.phone, {
      fecha: contexto.turno?.fecha,
      cuando,
    })
  }

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
  // Etiqueta primero, texto del paciente debajo. Ver el mismo bloque en
  // `gestionar/route.ts`.
  const desenlace = etiquetaDelDesenlace({
    tipo: accion === "cancelar" ? "cancelacion" : "confirmacion",
    cuando,
    profesional: contexto.turno?.profesional,
  })

  await anotarEnElMonitor({
    configId: contexto.configId,
    phoneNumber: contexto.phone,
    texto: `${desenlace}\n\n${texto}`,
  })

  try {
    // El contexto de turnos que tenía el bot quedó viejo en este instante.
    await clearAppointmentContext(contexto.phone, contexto.configId)
  } catch (error) {
    console.error("[PORTAL] No se pudo limpiar el contexto de turnos:", error)
  }

  return NextResponse.json({ ok: true, accion, texto })
}
