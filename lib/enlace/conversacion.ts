/**
 * La conversación del enlace: el motor de WhatsApp, en una página (14/10/2026).
 *
 * ── Qué es ─────────────────────────────────────────────────────────────────
 *
 * El "Cliente Chatbot por Enlace" replica la conversación que el paciente
 * tendría en WhatsApp si el cliente no usara enlace externo. No es el portal
 * con burbujas: usa EL MISMO motor conversacional —`existing-patient`,
 * `new-patient`, `reschedule`—, los mismos módulos que corre el bot.
 *
 * El primer intento fue dibujar la máquina de pasos del portal (`decidirPaso`)
 * como un chat. Se veía como un chat y no lo era: los pasos del portal y los
 * del bot no son los mismos, así que el paciente derivado veía un flujo
 * distinto del que venía teniendo. Queda anotado porque la diferencia no se ve
 * desde afuera y es fácil volver a confundirlas.
 *
 * ── La identidad viene del token, no se pregunta ───────────────────────────
 *
 * El widget de la web arranca pidiendo el DNI porque su visitante es anónimo.
 * Acá no: el enlace salió de una conversación donde el bot YA identificó al
 * paciente, y el token trae nombre, DNI, obra social y la intención elegida.
 * Volver a preguntar sería hacerle repetir lo que acaba de decir.
 *
 * ── Por qué la clave NO es el teléfono ─────────────────────────────────────
 *
 * El motor guarda su estado contra un identificador que en WhatsApp es el
 * teléfono. Si acá usáramos el mismo, la conversación del enlace y la de
 * WhatsApp compartirían las claves de Redis: el paciente que tiene un flujo
 * abierto en el chat y abre el enlace pisaría uno con el otro, y los dos
 * quedarían a mitad de camino.
 *
 * Se usa `web_<token>`, que además es el prefijo que `normalizePhoneNumber` ya
 * trata como caso especial en todo el proyecto. El teléfono real viaja aparte,
 * en `patientCelular`, para que la reserva y los recordatorios salgan al número
 * correcto y no al identificador de sesión — el mismo cuidado que ya tomó el
 * widget.
 */

import {
  initializeExistingPatientFlow,
  handleExistingPatientMessage,
  isExistingPatientFlowActive,
  clearExistingPatientFlow,
} from "../conversation-state/existing-patient/existing-patient-flow-integration"
import {
  initializeNewPatientFlow,
  handleNewPatientMessage,
  isNewPatientFlowActive,
  clearNewPatientFlow,
} from "../conversation-state/new-patient/new-patient-flow-integration"
import { createConversationLogger } from "../conversation-state/logger"
import type { ContextoDelPortal } from "../portal/token"
import { mensaje, type MensajeDelChat } from "./transcripcion"
import { sinPistaDeVolver } from "./texto"

/**
 * El identificador con el que el motor guarda el estado de ESTA conversación.
 *
 * Deriva del token y no del teléfono. Ver la cabecera.
 */
export function idDeSesion(token: string): string {
  return `web_${token}`
}

export interface RespuestaDelAsistente {
  mensajes: MensajeDelChat[]
  /** `true` cuando la gestión terminó: el cliente deja de ofrecer el campo de texto. */
  terminada?: boolean
}

/**
 * Los botones que el motor declara para cada mensaje.
 *
 * Son los mismos que el bot dibuja en WhatsApp como Reply Buttons o List
 * Message. El widget de la web los descarta porque no tiene dónde ponerlos;
 * acá sí, y por eso la conversación del enlace puede ser fiel a la de WhatsApp
 * en lugar de degradar todo a "respondé con el número".
 *
 * El orden importa: se devuelve el primero que venga, porque el motor manda
 * uno solo por mensaje.
 */
function botonesDelResultado(resultado: {
  sedesListRows?: Array<{ id: string; title: string; description?: string }>
  searchTypeButtons?: Array<{ id: string; title: string }>
  turnosButtons?: Array<{ id: string; title: string }>
  confirmationButtons?: boolean
  atrasButton?: boolean
  modifyMenuRows?: Array<{ id: string; title: string; description?: string }>
}): MensajeDelChat["botones"] {
  // El orden es el MISMO que el del embudo de `sendFlowResponse` en
  // lib/whatsapp.tsx, a propósito: si acá se eligiera otro, un paso que trae
  // dos conjuntos a la vez dibujaría una cosa en WhatsApp y otra en el enlace.
  const lista =
    resultado.sedesListRows ||
    resultado.modifyMenuRows ||
    resultado.searchTypeButtons ||
    resultado.turnosButtons

  if (lista?.length) {
    return lista.map((o) => {
      // `searchTypeButtons` y `turnosButtons` no tienen `description`: son Reply
      // Buttons, no filas de lista. De ahí el acceso defensivo.
      const detalle = (o as { description?: string }).description
      return { id: o.id, titulo: o.title, ...(detalle ? { detalle } : {}) }
    })
  }

  // `confirmationButtons` y `atrasButton` son booleanos: el motor dice "acá van
  // los botones de confirmar" y los textos los pone el canal. Se copian
  // literales de WhatsApp —incluido el id, que es lo que el motor espera
  // recibir como respuesta— para no abrir una segunda tabla de equivalencias.
  if (resultado.confirmationButtons) {
    return [
      { id: "1", titulo: "Sí, confirmar" },
      { id: "2", titulo: "No, modificar" },
      { id: "0", titulo: "Volver a paso ant." },
    ]
  }

  if (resultado.atrasButton) {
    return [{ id: "0", titulo: "Volver a paso ant." }]
  }

  return undefined
}

/**
 * Normaliza lo que devuelve cualquiera de los dos flujos a mensajes del chat.
 *
 * `greeting` va como mensaje aparte y primero: el motor lo redacta corto y
 * pensado para web ("Gracias, Juan. Te ayudaremos a gestionar tu nuevo
 * turno."), separado del `message` que lleva la pregunta. En una conversación
 * se leen mejor como dos burbujas que como un párrafo.
 */
type ResultadoDelMotor = {
  handled?: boolean
  message?: string
  greeting?: string
  action?: string
  shouldCallOpenAI?: boolean
} & Parameters<typeof botonesDelResultado>[0]

function aMensajes(resultado: ResultadoDelMotor): RespuestaDelAsistente {
  const mensajes: MensajeDelChat[] = []

  if (resultado.greeting) mensajes.push(mensaje("asistente", resultado.greeting))

  const botones = botonesDelResultado(resultado)

  if (resultado.message) {
    // `sinPistaDeVolver`: el motor cierra varios mensajes con "0. Volver al
    // paso anterior" porque en WhatsApp se contesta con un número. Acá eso ya
    // es un botón. Ver lib/enlace/texto.ts.
    mensajes.push(mensaje("asistente", sinPistaDeVolver(resultado.message), botones))
  } else if (resultado.shouldCallOpenAI) {
    // El motor se quedó sin respuesta determinística y en WhatsApp pasaría la
    // posta a la IA. Acá no hay ese respaldo —por ahora— y callarse dejaría al
    // paciente mirando un chat que no contesta, que es la peor salida posible.
    mensajes.push(
      mensaje(
        "asistente",
        "No entendí eso. Si querés, elegí una de las opciones de arriba; si no, escribinos por WhatsApp y te ayudamos.",
      ),
    )
  }

  if (mensajes.length === 0) {
    mensajes.push(mensaje("asistente", "Disculpá, no entendí. ¿Podés repetirlo?"))
  }

  return { mensajes, terminada: resultado.action === "turno_reservado" }
}

/**
 * Arranca la conversación con lo que el token ya sabe.
 *
 * Devuelve los primeros mensajes del asistente. No se llama más de una vez por
 * enlace: el llamador comprueba si ya hay transcripción.
 */
export async function iniciarConversacion(params: {
  token: string
  contexto: ContextoDelPortal
  escalationPhoneNumber?: string
  permitirNuevoTurno?: boolean
}): Promise<RespuestaDelAsistente> {
  const { token, contexto } = params
  const sesion = idDeSesion(token)
  const clienteId = contexto.clienteId || ""
  const logger = createConversationLogger(sesion, clienteId, "enlace_chat")

  const dni = contexto.identidad?.dni || contexto.pacienteDNI || ""
  const nombres = contexto.identidad?.nombre || contexto.pacienteNombres || ""
  const apellido = contexto.identidad?.apellido || contexto.pacienteApellido || ""
  const email = contexto.identidad?.email || contexto.pacienteEmail

  // Sin DNI no se puede sembrar nada: el motor identifica por documento. Pasa
  // con el paciente que el bot no reconoció, y ahí el flujo de paciente nuevo
  // lo pide igual que en WhatsApp.
  if (!dni) {
    logger.info("Enlace sin DNI en el token; arranca pidiendo los datos", {})
    const resultado = await initializeNewPatientFlow(
      "",
      sesion,
      clienteId,
      false,
      "",
      "widget",
      params.permitirNuevoTurno,
      params.escalationPhoneNumber,
    )
    return aMensajes(resultado as ResultadoDelMotor)
  }

  const resultado = await initializeExistingPatientFlow(
    sesion,
    contexto.pacienteId || "",
    [nombres, apellido].filter(Boolean).join(" ").trim(),
    dni,
    email,
    clienteId,
    {
      patientFirstName: nombres || undefined,
      patientLastName: apellido || undefined,
      obraSocialId: contexto.obraSocialId || contexto.identidad?.obraSocialId,
      obraSocialNombre: contexto.obraSocialNombre || contexto.identidad?.obraSocialNombre,
      // El teléfono real, para que la reserva no salga con `web_<token>`.
      patientCelular: contexto.phone,
    },
    params.escalationPhoneNumber,
    "",
    "widget",
    params.permitirNuevoTurno,
  )

  logger.info("Conversación del enlace iniciada", { intencion: contexto.intencion })
  return aMensajes(resultado as ResultadoDelMotor)
}

/**
 * Procesa lo que el paciente escribió o tocó.
 *
 * El orden de los dos flujos es el mismo que usa el widget: primero el de
 * paciente nuevo, después el de existente. No es arbitrario — el alta puede
 * arrancar DENTRO del flujo de existente (cuando el DNI no tenía ficha), y
 * preguntando primero por el de existente ese caso se enrutaría al flujo
 * equivocado.
 */
export async function continuarConversacion(params: {
  token: string
  contexto: ContextoDelPortal
  texto: string
  escalationPhoneNumber?: string
  permitirNuevoTurno?: boolean
}): Promise<RespuestaDelAsistente> {
  const sesion = idDeSesion(params.token)
  const clienteId = params.contexto.clienteId || ""

  let resultado: ResultadoDelMotor | null = null

  if (await isNewPatientFlowActive(sesion)) {
    resultado = (await handleNewPatientMessage(
      sesion,
      params.texto,
      clienteId,
      params.escalationPhoneNumber,
    )) as ResultadoDelMotor
  } else if (await isExistingPatientFlowActive(sesion)) {
    resultado = (await handleExistingPatientMessage(
      sesion,
      params.texto,
      clienteId,
      params.escalationPhoneNumber,
    )) as ResultadoDelMotor
  }

  // Sin flujo activo: o ya terminó, o el estado venció. Las dos cosas se le
  // dicen igual, porque para el paciente son lo mismo — y mandarlo a WhatsApp
  // es la salida que siempre funciona.
  if (!resultado) {
    return {
      mensajes: [
        mensaje(
          "asistente",
          "Esta conversación ya terminó. Si necesitás algo más, escribinos por WhatsApp y te ayudamos.",
        ),
      ],
      terminada: true,
    }
  }

  // El paciente apretó "volver" en el primer paso. En WhatsApp eso lo deja en
  // el menú principal; acá no hay menú —el enlace se emitió para una gestión
  // concreta— así que lo equivalente es volver al principio de esa gestión, que
  // es exactamente lo que `iniciarConversacion` arma. Sin esto el motor
  // devuelve un resultado sin `message` y el chat se quedaría mudo.
  if (resultado.action === "back_to_main_menu") {
    await clearExistingPatientFlow(sesion)
    await clearNewPatientFlow(sesion, clienteId)
    return iniciarConversacion({
      token: params.token,
      contexto: params.contexto,
      escalationPhoneNumber: params.escalationPhoneNumber,
      permitirNuevoTurno: params.permitirNuevoTurno,
    })
  }

  return aMensajes(resultado)
}
