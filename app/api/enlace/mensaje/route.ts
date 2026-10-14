/**
 * POST /api/enlace/mensaje — un turno de la conversación del enlace (14/10/2026).
 *
 * El paciente escribe o toca un botón, esto corre el motor conversacional y
 * devuelve lo que el asistente contesta. Es el único endpoint del chat: no hay
 * uno por paso, porque el paso lo sabe el motor y no el cliente.
 *
 * ── Qué autoriza ───────────────────────────────────────────────────────────
 *
 * El token, y nada más. Es el mismo criterio que el resto del portal: quien lo
 * tiene es el paciente al que se le mandó. Por eso acá se vuelven a correr
 * TODAS las guardas de vigencia en cada mensaje —no sólo al abrir la página—:
 * una pestaña que quedó abierta no puede seguir gestionando un enlace que
 * mientras tanto venció o se usó.
 *
 * ── Qué NO devuelve ────────────────────────────────────────────────────────
 *
 * Nada del contexto: ni el teléfono, ni el DNI, ni el id del paciente. Sólo
 * los mensajes. El cliente ya sabe quién es —se lo dijo el servidor al
 * renderizar— y cualquier dato extra acá sería una filtración a cambio de nada.
 */

import { NextResponse } from "next/server"
import { leerEnlace, consumirEnlace } from "@/lib/portal/token"
import { permiteGestionar } from "@/lib/portal/vigencia"
import { getWhatsAppConfigById } from "@/lib/db"
import { continuarConversacion } from "@/lib/enlace/conversacion"
import { agregarALaTranscripcion, mensaje } from "@/lib/enlace/transcripcion"
import { telefonoParaMensajes } from "@/lib/utils/escalation-contact"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** Tope del texto libre. Un DNI, un nombre o un número de opción; nada más. */
const TEXTO_MAX = 300

export async function POST(request: Request) {
  let cuerpo: { token?: string; texto?: string }
  try {
    cuerpo = await request.json()
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 })
  }

  const token = (cuerpo.token || "").trim()
  const texto = (cuerpo.texto || "").trim().slice(0, TEXTO_MAX)

  if (!token || !texto) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 })
  }

  // Sin la cookie del dispositivo: acá no se compara nada. `leerEnlace` la usa
  // para registrar la primera apertura, y eso ya pasó cuando se renderizó la
  // página. Pasarla de nuevo contaría una apertura por cada mensaje.
  const lectura = await leerEnlace(token)
  if (!lectura) {
    return NextResponse.json({ error: "Enlace no disponible" }, { status: 404 })
  }

  const { contexto, estado } = lectura

  if (contexto.resultado || !permiteGestionar(estado)) {
    return NextResponse.json({
      mensajes: [
        mensaje(
          "asistente",
          "Esta gestión ya se cerró. Si necesitás algo más, escribinos por WhatsApp.",
        ),
      ],
      terminada: true,
    })
  }

  // Las dos exclusiones de la página del chat valen también acá: una pestaña
  // vieja no puede entrar por la ventana. Ver las notas en
  // components/enlace/pagina-del-chat.tsx.
  if (contexto.demo) {
    return NextResponse.json({ error: "Enlace de prueba" }, { status: 409 })
  }

  if (contexto.intencion === "reagendar" || contexto.intencion === "cancelar") {
    return NextResponse.json({ error: "Gestión no disponible por el chat" }, { status: 409 })
  }

  if (!contexto.clienteId) {
    console.error(`[ENLACE] Contexto sin clienteId (config ${contexto.configId})`)
    return NextResponse.json({ error: "Configuración incompleta" }, { status: 500 })
  }

  const config = await getWhatsAppConfigById(contexto.configId)

  const respuesta = await continuarConversacion({
    token,
    contexto,
    texto,
    escalationPhoneNumber: telefonoParaMensajes(config),
    permitirNuevoTurno: config?.permitirNuevoTurno,
  })

  // Se guarda lo del paciente Y lo del asistente en una sola escritura, en
  // orden. Si se guardara sólo la respuesta, al recargar el paciente vería
  // contestaciones sin sus propias preguntas.
  await agregarALaTranscripcion(token, [mensaje("paciente", texto), ...respuesta.mensajes])

  // Reserva hecha: el enlace queda gestionado, así que si lo vuelve a abrir ve
  // el resultado en vez de un chat que ya no puede avanzar. El texto es el
  // último mensaje del motor, que es justamente el que describe lo que quedó.
  if (respuesta.terminada) {
    const ultimo = respuesta.mensajes[respuesta.mensajes.length - 1]
    await consumirEnlace(token, {
      texto: ultimo?.texto || "Tu turno quedó registrado.",
      tipo: contexto.turno ? "cambio" : "reserva",
    })
  }

  return NextResponse.json({ mensajes: respuesta.mensajes, terminada: !!respuesta.terminada })
}
