/**
 * La encuesta de satisfacción postoperatoria (3/11/2026).
 *
 * ── El flujo, completo ─────────────────────────────────────────────────────
 *
 * La clínica elige pacientes quirúrgicos en una página del VPS. El VPS nos
 * pide enviar la plantilla `encuesta_postoperatoria` por el mismo endpoint que
 * los recordatorios (/api/proxylistener), con dos botones:
 *
 *   · "Estoy conforme"            → payload ENCUESTA_CONFORME   → se manda el link
 *   · "Molestia o disconformidad" → payload ENCUESTA_DISCONFORME → se deriva
 *
 * Y el paciente también puede escribir en vez de tocar un botón. Si lo que
 * escribe suena a molestia, duda o disconformidad, se deriva igual.
 *
 * ── Por qué este estado existe ─────────────────────────────────────────────
 *
 * Porque la respuesta llega por el webhook común de Meta, que el VPS reenvía
 * crudo: no trae `Cliente_Id`, ni `Chatbot_Data`, ni el link. Sin guardar nada
 * al enviar, cuando el paciente toca "Estoy conforme" no tenemos qué mandarle.
 *
 * ── Y por qué NO va en el contexto de turnos ───────────────────────────────
 *
 * Esto es lo más importante del archivo. El `Chatbot_Data` de la encuesta no
 * tiene `turnos` ni `cantidad_turnos`, que en `ChatbotData` son obligatorios y
 * que medio proyecto lee sin preguntar. Si se guardara en el contexto de turnos
 * —que es lo que hace `sendReminderTemplate` con todo lo que le llega— lo que se
 * rompería no es la encuesta: es el flujo de turnos del paciente, que quedaría
 * con un contexto sin turnos y contestaría "no pudimos procesar tu
 * confirmación" la próxima vez que toque un botón de recordatorio.
 *
 * Clave propia, entonces, y el contexto de turnos no se toca.
 *
 * ── La ventana ─────────────────────────────────────────────────────────────
 *
 * Siete días. Decidido con Nicolás: la interpretación de texto libre corre sólo
 * mientras hay una encuesta abierta. Fuera de esa ventana, "tengo una duda" es
 * una consulta normal y la atiende el pipeline de siempre — si se interpretara
 * siempre, media conversación de turnos terminaría derivada.
 */

import { getRedisClient } from "../redis"

export const PAYLOAD_CONFORME = "ENCUESTA_CONFORME"
export const PAYLOAD_DISCONFORME = "ENCUESTA_DISCONFORME"

/** El `tipo_mensaje` con el que el VPS identifica este flujo. */
export const TIPO_MENSAJE_ENCUESTA = "encuesta_satisfaccion"

/** Siete días. Ver la nota de arriba. */
export const VENTANA_SEGUNDOS = 7 * 24 * 60 * 60

const PREFIJO = "encuesta:abierta:"

export interface EncuestaAbierta {
  clienteId: string
  /** El link que vino al enviar. `null` si la clínica no lo tenía cargado. */
  linkEncuesta: string | null
  /** El wamid de la plantilla enviada, para poder cruzarlo con `context.id`. */
  wamid?: string
  enviadaEl: string
  paciente?: { id?: string; hc?: string; nombres?: string; apellido?: string }
  cirugia?: {
    id?: string
    nombre?: string
    fecha?: string
    cirujano?: string
    ojo?: string
  }
  /**
   * Cuántas veces se le repreguntó porque no se entendió lo que escribió.
   *
   * Existe para que la repregunta no sea un bucle: a la segunda vez que no se
   * entiende, se deriva. Un paciente operado que escribe algo que el
   * clasificador no resuelve dos veces es exactamente el caso en el que hay
   * que dejar de adivinar y poner a una persona.
   */
  repreguntas?: number
}

function clave(configId: string, telefono: string): string {
  return `${PREFIJO}${configId}:${telefono}`
}

/** ¿Este `Chatbot_Data` es de una encuesta? */
export function esEncuestaPostoperatoria(chatbotData: unknown): boolean {
  const tipo = (chatbotData as { tipo_mensaje?: unknown } | null)?.tipo_mensaje
  return typeof tipo === "string" && tipo === TIPO_MENSAJE_ENCUESTA
}

/**
 * Deja la encuesta abierta para este paciente.
 *
 * Si ya había una, se reemplaza: la última enviada es la vigente. Dos encuestas
 * abiertas a la vez para el mismo teléfono no tienen sentido —el paciente
 * contesta una sola conversación— y elegir entre ellas sería adivinar.
 */
export async function abrirEncuesta(
  configId: string,
  telefono: string,
  datos: EncuestaAbierta,
): Promise<void> {
  const redis = getRedisClient()
  if (!redis || !configId || !telefono) return

  try {
    await redis.set(clave(configId, telefono), JSON.stringify(datos), { ex: VENTANA_SEGUNDOS })
    console.log(
      `[ENCUESTA] Abierta para ${telefono} (${configId}): ` +
        `cirugía ${datos.cirugia?.id ?? "?"}, link ${datos.linkEncuesta ? "sí" : "no"}`,
    )
  } catch (error) {
    console.error("[ENCUESTA] No se pudo abrir:", error)
  }
}

/** La encuesta abierta de este paciente, o `null`. */
export async function leerEncuestaAbierta(
  configId: string,
  telefono: string,
): Promise<EncuestaAbierta | null> {
  const redis = getRedisClient()
  if (!redis || !configId || !telefono) return null

  try {
    const crudo = await redis.get(clave(configId, telefono))
    if (!crudo) return null
    // Upstash deserializa solo lo que parece JSON: puede venir objeto o string.
    const datos = typeof crudo === "string" ? JSON.parse(crudo) : crudo
    return datos && typeof datos === "object" ? (datos as EncuestaAbierta) : null
  } catch (error) {
    console.error("[ENCUESTA] No se pudo leer:", error)
    return null
  }
}

/**
 * Cierra la encuesta: ya se contestó.
 *
 * Es lo que hace que un "gracias" dos semanas después no se lea como respuesta
 * a la encuesta, y que la interpretación de texto libre deje de correr en
 * cuanto el paciente ya dijo lo que tenía que decir.
 */
export async function cerrarEncuesta(configId: string, telefono: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis || !configId || !telefono) return

  try {
    await redis.del(clave(configId, telefono))
  } catch (error) {
    console.error("[ENCUESTA] No se pudo cerrar:", error)
  }
}

/** Suma una repregunta y devuelve cuántas van. */
export async function contarRepregunta(
  configId: string,
  telefono: string,
  encuesta: EncuestaAbierta,
): Promise<number> {
  const van = (encuesta.repreguntas || 0) + 1
  await abrirEncuesta(configId, telefono, { ...encuesta, repreguntas: van })
  return van
}

// ── Los textos ──────────────────────────────────────────────────────────────

function nombreDe(encuesta: EncuestaAbierta): string {
  const nombres = (encuesta.paciente?.nombres || "").trim()
  if (!nombres) return ""
  // Sólo el primer nombre, como el resto de los mensajes del bot.
  return nombres.split(/\s+/)[0]
}

/** "Gracias, Luis." o "Gracias." si no sabemos el nombre. */
function gracias(encuesta: EncuestaAbierta): string {
  const nombre = nombreDe(encuesta)
  return nombre ? `¡Gracias, ${nombre}!` : "¡Gracias!"
}

/**
 * La etiqueta del botón que lleva a la encuesta.
 *
 * Máximo 20 caracteres: es el límite de `display_text` de un CTA URL. "Dejar
 * opinión" tiene 14, y el texto del mensaje lo nombra, así que si alguien lo
 * cambia por algo más largo llegaría cortado en los dos lugares. Hay un assert
 * que verifica el largo.
 */
export const BOTON_DE_LA_ENCUESTA = "Dejar opinión"

/**
 * El cuerpo del mensaje que acompaña al botón (3/11/2026).
 *
 * La URL NO va en el texto: va en el botón. Un enlace crudo en el cuerpo
 * compite con el botón —el paciente ve dos formas de hacer lo mismo— y encima
 * las URLs de encuesta son largas y ocupan tres renglones.
 *
 * Por eso esta función ya no recibe el link: lo estampa el botón. Si recibiera
 * las dos cosas, nada impediría que el texto mostrara una URL y el botón
 * llevara a otra.
 */
export function mensajeConLink(encuesta: EncuestaAbierta): string {
  return `${gracias(encuesta)} Nos alegra mucho saber que estás bien.

Podés dejarnos tu opinión sobre la atención que recibiste utilizando el botón.

Nos ayuda a seguir mejorando. ¡Que tengas un buen día!`
}

/**
 * El mismo agradecimiento, sin encuesta.
 *
 * Decidido con Nicolás: no se promete un link que no existe ni se deriva a una
 * persona por un problema de configuración de la clínica. El paciente contestó
 * que está bien y recibe un agradecimiento; que falte el link queda en el log,
 * que es donde lo tenemos que ver nosotros y no él.
 */
export function mensajeSinLink(encuesta: EncuestaAbierta): string {
  return `${gracias(encuesta)} Nos alegra mucho saber que estás bien.

Gracias por tomarte el momento de responder. ¡Que tengas un buen día!`
}

/** Lo que se le dice al paciente cuando se lo deriva por una molestia. */
export function mensajeDerivacionPorMolestia(encuesta: EncuestaAbierta): string {
  const nombre = nombreDe(encuesta)
  const saludo = nombre ? `Gracias por contarnos, ${nombre}.` : "Gracias por contarnos."
  return `${saludo} Voy a avisarle al consultorio para que alguien del equipo te contacte y pueda ayudarte.

En un momento te responden por acá.`
}

/**
 * La misma derivación cuando la clínica no tiene atención humana por este
 * medio: ahí lo único útil es el teléfono.
 *
 * El teléfono lo resuelve el llamador con `telefonoParaMensajes(config, {
 * ultimaSalida: true })`, que lo devuelve aunque el switch esté apagado — es
 * uno de los dos casos para los que esa excepción existe: no hay a quién
 * derivar, y callarse le cerraría la única puerta que le queda.
 */
export function mensajeDerivacionAlTelefono(
  encuesta: EncuestaAbierta,
  contacto?: string,
): string {
  const nombre = nombreDe(encuesta)
  const saludo = nombre ? `Gracias por contarnos, ${nombre}.` : "Gracias por contarnos."

  if (!contacto) {
    return `${saludo} Es importante que lo comentes directamente con el consultorio para que puedan evaluarte.`
  }

  const multilinea = contacto.trim().includes("\n")
  return multilinea
    ? `${saludo} Es importante que lo comentes directamente con el consultorio para que puedan evaluarte. Podés comunicarte acá:

${contacto.trim()}`
    : `${saludo} Es importante que lo comentes directamente con el consultorio para que puedan evaluarte. Podés comunicarte al *${contacto.trim()}*.`
}

/** La repregunta, cuando no se entendió qué quiso decir. */
export function mensajeRepregunta(encuesta: EncuestaAbierta): string {
  const nombre = nombreDe(encuesta)
  const saludo = nombre ? `Perdón, ${nombre}, no quiero equivocarme:` : "Perdón, no quiero equivocarme:"
  return `${saludo} ¿estás teniendo alguna molestia o duda con tu recuperación, o querías comentarnos otra cosa?

Si tenés una molestia, avisame y te comunico con el consultorio.`
}
