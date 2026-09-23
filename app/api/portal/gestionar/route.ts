/**
 * La única ruta del portal que toca turnos de verdad (22/9/2026).
 *
 * ── Primero reservar, después cancelar ─────────────────────────────────────
 *
 * El orden no es indiferente y es la decisión más importante de este archivo.
 *
 * Si cancelamos primero y la reserva falla, el paciente queda SIN turno y
 * creyendo que lo cambió. Es exactamente el caso de Norma: la paciente que
 * creyó haber reagendado y se quedó sin nada, y nadie se enteró hasta que se
 * presentó en la clínica.
 *
 * Si reservamos primero y la cancelación falla, el paciente queda con DOS
 * turnos. Es un problema, pero es visible: la clínica lo ve en su agenda, el
 * paciente recibe dos confirmaciones, y se arregla. Un turno de más se
 * cancela; un turno de menos se pierde.
 *
 * ── La autorización es el token ────────────────────────────────────────────
 *
 * No hay sesión ni login. El token del enlace es la credencial, y ya está
 * acotado a una acción, un paciente y un turno. Esta ruta NO acepta un
 * `pacienteId` ni un `clienteId` del cuerpo: todo eso sale del token. Si
 * viniera del cliente, cualquiera podría reservar a nombre de cualquiera.
 */

import { NextResponse } from "next/server"
import { leerEnlace, consumirEnlace, type TurnoDelPortal } from "@/lib/portal/token"
import { permiteGestionar } from "@/lib/portal/vigencia"
import { reservarTurno, cancelarTurno } from "@/lib/api-tools/api-functions"
import { saveConversationMessage } from "@/lib/conversations"
import { clearAppointmentContext } from "@/lib/appointment-flow-state"
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
  const agendaId = String(cuerpo.agendaId || "")
  if (!token || !agendaId) {
    return NextResponse.json({ ok: false, error: "Faltan datos" }, { status: 400 })
  }

  const lectura = await leerEnlace(token)
  if (!lectura) {
    return NextResponse.json(
      { ok: false, error: "Este enlace ya no está disponible." },
      { status: 404 },
    )
  }

  const { contexto, estado } = lectura

  if (!permiteGestionar(estado)) {
    // Incluye el caso de haberlo usado dos veces: si el paciente tocó dos
    // veces el botón, la segunda no reserva nada.
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

  const datosDelTurnoElegido: TurnoDelPortal = {
    agendaId,
    fecha: cuerpo.fecha || undefined,
    fechaFormateada: cuerpo.fechaFormateada || undefined,
    hora: cuerpo.hora || undefined,
    horaFormateada: cuerpo.hora || undefined,
    profesional: cuerpo.profesional || undefined,
    sede: cuerpo.sede || contexto.turno?.sede,
    direccion: contexto.turno?.direccion,
  }

  // ── Enlace de prueba: se recorre todo, no se escribe nada ────────────────
  //
  // Corta ANTES de la reserva, no después. Poner el `if` más abajo dejaría el
  // camino abierto a que un refactor futuro mueva la llamada al proxy por
  // encima del corte y un enlace de demo termine tocando la agenda de una
  // clínica real.
  if (contexto.demo) {
    const cuandoDemo = [cuerpo.fechaFormateada, cuerpo.hora].filter(Boolean).join(" a las ")
    const textoDemo = cuandoDemo
      ? `Tu turno quedó para el ${cuandoDemo}.`
      : "Tu turno quedó reservado."

    await consumirEnlace(token, { texto: textoDemo, turno: datosDelTurnoElegido })
    console.log(`[PORTAL] Enlace de PRUEBA consumido; no se tocó ninguna agenda (${contexto.phone})`)

    return NextResponse.json({ ok: true, demo: true, texto: textoDemo, turno: datosDelTurnoElegido })
  }

  // ── Los datos con los que se reserva ──────────────────────────────────────
  //
  // Dos orígenes posibles y una sola forma de leerlos. `contexto.identidad` es
  // lo que el propio portal averiguó cuando el bot no reconoció al paciente;
  // los campos sueltos del contexto son lo que el bot ya sabía. Se prefiere la
  // identidad porque es más reciente y más completa: incluye el email y el
  // apellido, que el bot no guarda en el token.
  //
  // Para un paciente nuevo, ESTE es el momento en que se crea su ficha. No se
  // creó antes a propósito: dar de alta al completar el formulario llenaría la
  // base de la clínica de gente que abandonó antes de elegir horario.
  const ident = contexto.identidad
  const datosDelPaciente = {
    telefono: contexto.phone,
    // El proxy exige el campo. Vacío para el paciente que ya tiene ficha —su
    // email está en el sistema de la clínica y no queremos pisarlo con nada—,
    // y con el que cargó cuando es un alta.
    email: ident?.tieneFicha === false ? ident?.email || "" : "",
    dni: ident?.dni || contexto.pacienteDNI,
    nombre: ident?.nombre || contexto.pacienteNombre,
    apellido: ident?.apellido,
    deudorId: ident?.obraSocialId || contexto.obraSocialId,
    deudorNombre: ident?.obraSocialNombre,
  }

  // Un alta sin nombre o sin DNI crearía una ficha inservible. Antes que eso,
  // se le pide que vuelva por WhatsApp: una ficha fantasma en el sistema de la
  // clínica es un problema que alguien va a tener que limpiar a mano.
  if (!datosDelPaciente.dni || !datosDelPaciente.nombre) {
    console.error(`[PORTAL] Reserva sin datos suficientes para ${contexto.phone}`)
    return NextResponse.json(
      { ok: false, error: "Nos faltan algunos de tus datos. Escribinos por WhatsApp y lo resolvemos." },
      { status: 400 },
    )
  }

  // ── 1. Reservar ───────────────────────────────────────────────────────────
  let reserva: any
  try {
    reserva = await reservarTurno(contexto.clienteId, agendaId, datosDelPaciente)
  } catch (error) {
    console.error("[PORTAL] Error reservando:", error)
    return NextResponse.json(
      { ok: false, error: "No pudimos reservar ese horario. Probá con otro o escribinos por WhatsApp." },
      { status: 502 },
    )
  }

  if (!reserva?.exito) {
    // La causa habitual: alguien más tomó ese horario mientras el paciente
    // elegía. Se lo decimos así, no como un error del sistema.
    console.warn("[PORTAL] La reserva no prosperó:", JSON.stringify(reserva)?.slice(0, 400))
    return NextResponse.json(
      {
        ok: false,
        recargar: true,
        error: "Ese horario ya no está disponible. Elegí otro de la lista.",
      },
      { status: 409 },
    )
  }

  // ── 2. Cancelar el anterior ───────────────────────────────────────────────
  //
  // Sólo si había uno. Si falla, NO se revierte la reserva: el paciente ya
  // tiene su turno nuevo, que es lo que vino a hacer. Queda registrado para
  // que la clínica lo resuelva.
  let cancelacionFallida = false
  // Se usa el DNI unificado, no `contexto.pacienteDNI`: si el paciente se
  // identificó en el portal, su DNI vive en `identidad` y esta condición sería
  // falsa — el turno anterior quedaría sin cancelar y en silencio.
  if (contexto.intencion === "reagendar" && contexto.turno?.fecha && datosDelPaciente.dni) {
    try {
      const cancelacion = await cancelarTurno(contexto.clienteId, {
        fecha: contexto.turno.fecha,
        motivo: "Reprogramado por el paciente desde el portal",
        paciente_datos: { dni: datosDelPaciente.dni, telefono: contexto.phone },
      })
      if (cancelacion && cancelacion.exito === false) cancelacionFallida = true
    } catch (error) {
      cancelacionFallida = true
      console.error("[PORTAL] Error cancelando el turno anterior:", error)
    }

    if (cancelacionFallida) {
      console.error(
        `[PORTAL] ⚠️ ATENCIÓN: ${contexto.phone} quedó con DOS turnos. ` +
          `Nuevo: ${agendaId}. Anterior sin cancelar: ${contexto.turno.fecha}.`,
      )
    }
  }

  // ── 3. Cerrar el enlace y dejar rastro ────────────────────────────────────
  const cuando = [datosDelTurnoElegido.fechaFormateada, datosDelTurnoElegido.horaFormateada]
    .filter(Boolean)
    .join(" a las ")
  const conQuien = datosDelTurnoElegido.profesional ? ` con ${datosDelTurnoElegido.profesional}` : ""
  const texto = cuando
    ? `Tu turno quedó para el ${cuando}${conQuien}.`
    : "Tu turno quedó reservado."

  await consumirEnlace(token, { texto, turno: datosDelTurnoElegido })

  // El bot y el panel tienen que enterarse. Sin esto, un agente abre la
  // conversación y ve que el paciente recibió un enlace y desapareció; y si el
  // paciente después pregunta "¿me quedó?", el bot contesta con datos viejos.
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
    // El contexto de turnos que tenía el bot quedó viejo en este mismo instante.
    await clearAppointmentContext(contexto.phone, contexto.configId)
  } catch (error) {
    console.error("[PORTAL] No se pudo registrar en la conversación:", error)
  }

  return NextResponse.json({
    ok: true,
    texto,
    turno: datosDelTurnoElegido,
    // Se informa para que la interfaz pueda sugerirle al paciente que avise,
    // en vez de dejarlo con dos turnos sin saberlo.
    ...(cancelacionFallida ? { avisoCancelacion: true } : {}),
  })
}
