/**
 * El enlace en formato de CHAT (14/10/2026).
 *
 * El "Cliente Chatbot por Enlace": la misma conversación que el paciente
 * tendría en WhatsApp, en una página. Corre el motor conversacional —los
 * módulos `existing-patient` / `new-patient` que corre el bot—, no la máquina
 * de pasos del portal.
 *
 * ── Lo que esta página hace ────────────────────────────────────────────────
 *
 * Resolver el token, correr las guardas de vigencia, y sembrar la conversación
 * si es la primera visita. Después le pasa la transcripción al cliente, que de
 * ahí en adelante habla con `POST /api/enlace/mensaje`.
 *
 * ── Por qué se siembra en el servidor y no en el cliente ───────────────────
 *
 * Porque el primer mensaje tiene que estar en el HTML. Si el chat arrancara
 * vacío y pidiera el saludo por fetch, el paciente que abre el enlace desde el
 * navegador interno de WhatsApp —con señal de móvil— vería una pantalla en
 * blanco el tiempo que tarde la agenda de la clínica en contestar. Un chat
 * vacío no se lee como "cargando", se lee como "roto".
 *
 * ── El enlace de prueba no corre el motor ──────────────────────────────────
 *
 * El modo demo del portal recorre todas las pantallas sin tocar la agenda,
 * porque la reserva la hace la propia página y ahí se puede saltear. Acá la
 * reserva la hace el motor, varias capas adentro, y no hay forma honesta de
 * "casi" reservar: o se reserva de verdad en la agenda de una clínica real, o
 * no se corre. Se eligió no correrlo y decirlo en pantalla.
 */

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { randomBytes } from "crypto"
import { leerEnlace } from "@/lib/portal/token"
import { marcaDelPortal } from "@/lib/portal/marca"
import { saludoDelChat } from "@/lib/portal/contenido"
import { getWhatsAppConfigById } from "@/lib/db"
import { Marco, Aviso } from "@/components/portal/marco"
import { pantallaTerminal } from "@/components/portal/pantalla-terminal"
import { ChatDelEnlace } from "@/components/enlace/chat"
import {
  leerTranscripcion,
  agregarALaTranscripcion,
  mensaje,
} from "@/lib/enlace/transcripcion"
import { iniciarConversacion } from "@/lib/enlace/conversacion"
import { telefonoParaMensajes } from "@/lib/utils/escalation-contact"

/** La misma cookie que el portal: es el mismo enlace, visto de otra forma. */
const COOKIE_DISPOSITIVO = "portal_dispositivo"

export async function PaginaDelChat({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const almacen = await cookies()

  let secreto = almacen.get(COOKIE_DISPOSITIVO)?.value
  let secretoNuevo: string | null = null
  if (!secreto) {
    secreto = randomBytes(16).toString("base64url")
    secretoNuevo = secreto
  }

  const lectura = await leerEnlace(token, secreto)
  const config = lectura ? await getWhatsAppConfigById(lectura.contexto.configId) : null
  const marca = marcaDelPortal(config)

  const terminal = pantallaTerminal({
    lectura,
    marca,
    token,
    cookieNueva: secretoNuevo,
    nombreCookie: COOKIE_DISPOSITIVO,
    formato: "chat",
  })
  if (terminal) return <>{terminal}</>

  // `pantallaTerminal` devolvió null, así que la lectura existe.
  const { contexto, dispositivoDistinto } = lectura!

  if (dispositivoDistinto) {
    console.warn(`[ENLACE] ${contexto.phone} abrió su chat desde otro dispositivo`)
  }

  const marco = (hijos: React.ReactNode) => (
    <Marco
      marca={marca}
      cookieNueva={secretoNuevo}
      nombreCookie={COOKIE_DISPOSITIVO}
      token={token}
      formato="chat"
    >
      {hijos}
    </Marco>
  )

  /**
   * Reagendar y cancelar todavía no corren por el chat (14/10/2026).
   *
   * El motor que maneja esas dos gestiones —`reschedule-flow-integration.ts`—
   * no devuelve mensajes: los MANDA él mismo por WhatsApp, y recibe el
   * `phoneNumberId` y el `accessToken` para hacerlo. Envolverlo no alcanza; hay
   * que separar "decidir qué contestar" de "mandarlo", igual que ya están
   * separados los flujos de paciente nuevo y existente.
   *
   * Hasta entonces, estos enlaces van al formato de pantallas, que sí sabe
   * reagendar y cancelar completo. La alternativa era dejar que el chat
   * arrancara el flujo de turno NUEVO —que es a lo que lleva
   * `initializeExistingPatientFlow`— y que el paciente que tocó "Cancelar" en
   * el recordatorio terminara sacando un segundo turno sin soltar el primero.
   *
   * Vale la pena decirlo claro: la mayor parte del volumen entra por el
   * recordatorio, así que mientras esto siga acá, buena parte de los pacientes
   * de un cliente con el chatbot activado va a ver pantallas y no chat.
   */
  if (contexto.intencion === "reagendar" || contexto.intencion === "cancelar") {
    console.info(
      `[ENLACE] ${contexto.intencion} todavía no corre por el chat: va a pantallas (${token.slice(0, 6)}…)`,
    )
    redirect(`/p/${token}`)
  }

  if (contexto.demo) {
    return marco(
      <Aviso
        tono="atencion"
        titulo="Enlace de prueba"
        detalle="El chat corre el mismo motor que WhatsApp y reservaría de verdad, así que en los enlaces de prueba no se activa. Para probarlo, usá un enlace real o el formato de pantallas."
      />,
    )
  }

  if (!contexto.clienteId) {
    console.error(`[ENLACE] Contexto sin clienteId (config ${contexto.configId})`)
    return marco(
      <Aviso
        tono="atencion"
        titulo="No pudimos abrir el chat"
        detalle="Escribinos por WhatsApp y lo resolvemos."
      />,
    )
  }

  // La transcripción es la que manda sobre qué se dibuja. Si ya existe, el
  // paciente está volviendo o recargó: NO se vuelve a sembrar —eso le
  // duplicaría el saludo y, peor, reiniciaría el flujo del motor en medio de
  // una reserva a medio hacer.
  let transcripcion = await leerTranscripcion(token)

  if (transcripcion.length === 0) {
    const nombre = (contexto.pacienteNombre || contexto.identidad?.nombre)?.trim().split(/\s+/)[0]

    // El saludo lo pone la página y no el motor, a propósito. El motor saluda
    // como si la conversación empezara acá ("Gracias, Juan…"); esta
    // conversación VIENE de WhatsApp, y decirlo evita el "¿esto es de la
    // clínica?" que termina en un mensaje preguntándole al bot.
    const saludo = mensaje(
      "asistente",
      saludoDelChat({
        nombre,
        clinica: config?.displayName,
        paraFamiliar: contexto.intencion === "familiar",
      }),
    )

    const respuesta = await iniciarConversacion({
      token,
      contexto,
      escalationPhoneNumber: telefonoParaMensajes(config),
      permitirNuevoTurno: config?.permitirNuevoTurno,
    })

    transcripcion = await agregarALaTranscripcion(token, [saludo, ...respuesta.mensajes])
  }

  return marco(
    <ChatDelEnlace
      token={token}
      inicial={transcripcion}
      terminadaInicial={Boolean(contexto.resultado)}
    />,
  )
}
