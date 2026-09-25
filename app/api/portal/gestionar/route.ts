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
import { permiteGestionar, reemplazaElTurnoPrevio } from "@/lib/portal/vigencia"
import { resolverPorDNI } from "@/lib/portal/identidad"
import { reservarTurno, cancelarTurno } from "@/lib/api-tools/api-functions"
import { saveConversationMessage } from "@/lib/conversations"
import { clearAppointmentContext } from "@/lib/appointment-flow-state"
import { trackAppointmentEvent, checkAndClearPendingReschedule } from "@/lib/appointment-stats"
import { olvidarCancelacion } from "@/lib/portal/cancelacion-reciente"
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
  let ident = contexto.identidad

  // ── El apellido tiene que ir aparte (25/9/2026) ───────────────────────────
  //
  // `set_turno` responde "Debe proporcionar Nombre, Apellido, DNI y al menos
  // un medio de contacto" si falta el apellido. El portal mandaba
  // `Paciente_Nombre: "Nicolas DE SANTIAGO"` —el nombre completo en un solo
  // campo— y ningún apellido, así que toda reserva de un paciente que el BOT
  // había identificado fallaba. El token del bot trae `pacienteNombre` entero;
  // nombre y apellido separados sólo los tiene el portal cuando él mismo buscó
  // la ficha.
  //
  // Se resuelve preguntándole a quien sabe, no partiendo la cadena: "DE
  // SANTIAGO, Nicolas" y "Nicolas DE SANTIAGO" conviven en la misma base, y
  // cualquier regla para partirlas se equivoca en la mitad de los casos. La
  // ficha ya tiene los dos campos separados y la buscamos por DNI, que lo
  // tenemos.
  const dniParaReservar = ident?.dni || contexto.pacienteDNI

  // Primero, lo que ya vino en el token: la clínica manda nombre y apellido
  // separados en el `Chatbot_Data` del recordatorio, así que para el paciente
  // que identificó el bot no hace falta preguntar nada.
  const apellidoConocido = ident?.apellido || contexto.pacienteApellido

  // Sólo si NO lo tenemos se va a buscar la ficha. Es el respaldo para los
  // enlaces emitidos antes de este arreglo y para los casos donde la clínica
  // no manda `Chatbot_Data`.
  if (!apellidoConocido && dniParaReservar) {
    const ficha = await resolverPorDNI(contexto.clienteId, dniParaReservar)
    if (ficha?.tieneFicha) {
      // La ficha completa los huecos; lo que el paciente haya cargado en el
      // portal manda por encima, porque es más reciente.
      ident = { ...ficha, ...(contexto.identidad || {}) }
    } else {
      console.warn(`[PORTAL] No se pudo traer la ficha de ${contexto.phone} para completar el apellido`)
    }
  }

  // ── Los mismos campos que manda el bot ────────────────────────────────────
  //
  // `reschedule-flow-integration.ts` arma `{ dni, nombre: paciente.nombres,
  // apellido: paciente.apellido, telefono, obra_social_id }`. Esto es lo
  // mismo, con el email de yapa cuando lo hay.
  //
  // El orden de preferencia en cada campo: lo que el paciente cargó en el
  // portal (más reciente), después lo que vino en el token, y por último lo
  // que se haya traído de la ficha.
  const datosDelPaciente = {
    telefono: contexto.phone,
    email: ident?.email || contexto.pacienteEmail || "",
    dni: dniParaReservar,
    // `pacienteNombres` son los nombres de pila. `pacienteNombre` es el
    // completo y sólo se usa si no hay nada mejor: mandarlo como
    // `Paciente_Nombre` junto a un apellido vacío es justo lo que fallaba.
    nombre: ident?.nombre || contexto.pacienteNombres || contexto.pacienteNombre,
    apellido: ident?.apellido || contexto.pacienteApellido,
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
  let seCancelóElAnterior = false
  // Se usa el DNI unificado, no `contexto.pacienteDNI`: si el paciente se
  // identificó en el portal, su DNI vive en `identidad` y esta condición sería
  // falsa — el turno anterior quedaría sin cancelar y en silencio.
  if (reemplazaElTurnoPrevio(contexto.intencion) && contexto.turno?.fecha && datosDelPaciente.dni) {
    try {
      const cancelacion = await cancelarTurno(contexto.clienteId, {
        fecha: contexto.turno.fecha,
        motivo: "Reprogramado por el paciente desde el portal",
        paciente_datos: { dni: datosDelPaciente.dni, telefono: contexto.phone },
      })
      if (cancelacion && cancelacion.exito === false) cancelacionFallida = true
      else seCancelóElAnterior = true
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

  // ── 3. ¿Quedó confirmado, o pendiente de la clínica? ──────────────────────
  //
  // `set_turno` puede devolver `confirmacion_humana`: el turno no queda
  // otorgado hasta que la clínica lo apruebe. El flujo conversacional lo mira
  // (confirmation-handler.ts) y avisa; el portal no lo miraba y le decía a todo
  // el mundo "tu turno quedó para el...". A alguien que en realidad tiene una
  // SOLICITUD pendiente, eso lo manda a la clínica el día equivocado.
  //
  // Default `true` —el comportamiento de siempre— cuando el proxy de esa
  // clínica todavía no manda el campo. Es el mismo criterio que el flujo
  // conversacional, y acá importa el sentido del default: ante la duda se
  // avisa que puede requerir aprobación, que es el error inofensivo.
  const confirmacionHumana =
    (reserva?.datos as { confirmacion_humana?: boolean } | undefined)?.confirmacion_humana ?? true

  // ── 4. Cerrar el enlace y dejar rastro ────────────────────────────────────
  const cuando = [datosDelTurnoElegido.fechaFormateada, datosDelTurnoElegido.horaFormateada]
    .filter(Boolean)
    .join(" a las ")
  const conQuien = datosDelTurnoElegido.profesional ? ` con ${datosDelTurnoElegido.profesional}` : ""

  const textoDelTurnoNuevo = confirmacionHumana
    ? cuando
      ? `Pedimos tu turno para el ${cuando}${conQuien}. La clínica tiene que aprobarlo y te avisamos apenas lo haga.`
      : "Pedimos tu turno. La clínica tiene que aprobarlo y te avisamos apenas lo haga."
    : cuando
      ? `Tu turno quedó para el ${cuando}${conQuien}.`
      : "Tu turno quedó reservado."

  // ── Decir que el anterior se canceló (25/9/2026) ──────────────────────────
  //
  // El mensaje hablaba sólo del turno nuevo. Quien reagenda se queda sin saber
  // qué pasó con el que tenía, y cuando el nuevo además queda pendiente de
  // aprobación, la duda es peor: ¿me guardan el viejo mientras tanto?
  //
  // Se dice explícitamente. Es la mitad de la operación que el paciente pidió
  // y es la mitad que no puede ver en ningún lado.
  const fechaAnterior =
    contexto.turno?.fechaFormateada || contexto.turno?.fecha
      ? [contexto.turno?.fechaFormateada || contexto.turno?.fecha, contexto.turno?.horaFormateada]
          .filter(Boolean)
          .join(" a las ")
      : ""

  const texto = seCancelóElAnterior
    ? `${textoDelTurnoNuevo} Cancelamos el turno${fechaAnterior ? ` del ${fechaAnterior}` : " anterior"}.`
    : textoDelTurnoNuevo

  // ── Las estadísticas (24/9/2026) ──────────────────────────────────────────
  //
  // No es un extra. Sin esto, cada turno sacado por el portal es invisible en
  // /dashboard/estadisticas, y la clínica ve caer sus "Nuevos turnos" justo
  // cuando el portal empieza a funcionar: exactamente la conclusión opuesta a
  // la realidad.
  //
  // Ya pasó una vez con el flujo conversacional —está documentado en
  // confirmation-handler.ts, 19/8/2026— y esto sería repetirlo. Se usa la misma
  // función y el mismo criterio: `checkAndClearPendingReschedule` distingue un
  // reagendamiento de un turno nuevo genuino.
  //
  // Best-effort: un error acá no puede tapar una reserva que sí ocurrió.
  try {
    const veniaDeUnaCancelacion = await checkAndClearPendingReschedule(contexto.clienteId, contexto.phone)
    await trackAppointmentEvent({
      clienteId: contexto.clienteId,
      phoneNumber: contexto.phone,
      eventType:
        reemplazaElTurnoPrevio(contexto.intencion) || veniaDeUnaCancelacion
          ? "rescheduled"
          : "new_appointment",
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("[PORTAL] No se pudo registrar la estadística de la reserva:", error)
  }

  await consumirEnlace(token, { texto, turno: datosDelTurnoElegido })

  // Volvió a tener turno: el rastro de la cancelación anterior ya no aplica, y
  // dejarlo haría que el bot le diga "tu turno fue cancelado" cuando acaba de
  // sacar uno.
  await olvidarCancelacion(contexto.configId, contexto.phone)

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
    // La interfaz lo usa para no decir "Listo" cuando todavía falta que la
    // clínica apruebe.
    pendienteDeAprobacion: confirmacionHumana,
    turno: datosDelTurnoElegido,
    // Se informa para que la interfaz pueda sugerirle al paciente que avise,
    // en vez de dejarlo con dos turnos sin saberlo.
    ...(cancelacionFallida ? { avisoCancelacion: true } : {}),
  })
}
