/**
 * El mensaje de WhatsApp que lleva al portal (22/9/2026).
 *
 * ── Tres restricciones del botón CTA que definen el diseño ─────────────────
 *
 * 1. **Sólo un botón por mensaje**, y no se puede combinar con botones de
 *    respuesta rápida. O sea que el mensaje que lleva el enlace no puede
 *    ofrecer además "prefiero hablar con alguien": eso va en el texto.
 *
 * 2. **Tocarlo no genera ningún webhook.** No nos enteramos de que el paciente
 *    abrió el enlace. El único que puede avisarnos es el portal cuando carga,
 *    así que toda la medición del embudo vive del lado del portal.
 *
 * 3. **No renueva la ventana de 24 h**, porque no es un mensaje del usuario.
 *    En la práctica alcanza —el paciente abre el enlace a los segundos de
 *    recibirlo, y la ventana sigue abierta por el mensaje que disparó esta
 *    respuesta— pero condiciona cualquier aviso posterior.
 */

import { fraseDerivacion } from "../utils/escalation-contact"
import type { IntencionDelPortal } from "./vigencia"

export const LIMITE_TEXTO_BOTON = 20
export const LIMITE_ENCABEZADO = 60
export const LIMITE_PIE = 60

export interface MensajeConEnlace {
  messaging_product: "whatsapp"
  recipient_type: "individual"
  to: string
  type: "interactive"
  interactive: Record<string, any>
}

/**
 * Arma el payload. Separado del envío para poder testear lo que importa —que
 * la URL viaje entera, que los textos entren en los límites— sin tocar la red.
 */
export function construirMensajeConEnlace(params: {
  to: string
  cuerpo: string
  url: string
  textoDelBoton?: string
  encabezado?: string
  pie?: string
}): MensajeConEnlace {
  const interactive: Record<string, any> = {
    type: "cta_url",
    body: { text: params.cuerpo },
    action: {
      name: "cta_url",
      parameters: {
        display_text: acotar(params.textoDelBoton || "Gestionar mi turno", LIMITE_TEXTO_BOTON),
        // La URL NO se acorta nunca. Si no entrara, el enlace dejaría de
        // funcionar y el paciente vería un botón que lo lleva a un error.
        url: params.url,
      },
    },
  }

  if (params.encabezado) {
    interactive.header = { type: "text", text: acotar(params.encabezado, LIMITE_ENCABEZADO) }
  }
  if (params.pie) {
    interactive.footer = { text: acotar(params.pie, LIMITE_PIE) }
  }

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: params.to,
    type: "interactive",
    interactive,
  }
}

function acotar(texto: string, maximo: number): string {
  const limpio = (texto || "").trim()
  if (limpio.length <= maximo) return limpio
  return limpio.slice(0, maximo - 1).trimEnd() + "…"
}

/**
 * Envía el mensaje.
 *
 * Si falla, el llamador debería caer al flujo conversacional de siempre: un
 * paciente atendido por el camino viejo es mucho mejor que un paciente sin
 * respuesta.
 */
export async function enviarMensajeConEnlace(
  phoneNumberId: string,
  accessToken: string,
  mensaje: MensajeConEnlace,
): Promise<any> {
  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`

  const respuesta = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(mensaje),
  })

  const datos = await respuesta.json().catch(() => null)

  if (!respuesta.ok) {
    console.error("[PORTAL] ❌ Error enviando el enlace:", JSON.stringify(datos))
    throw new Error(`WhatsApp CTA URL error: ${JSON.stringify(datos)}`)
  }

  console.log(`[PORTAL] ✅ Enlace enviado a ${mensaje.to}`)
  return datos
}

// ─── Textos ──────────────────────────────────────────────────────────────────

/**
 * Una plantilla por flujo, y nada más que eso (24/9/2026).
 *
 * ── Por qué una tabla y no una función por caso ────────────────────────────
 *
 * Los textos anteriores eran dos funciones que armaban el mensaje con
 * concatenaciones: para cambiar una palabra había que leer código. Y eran
 * distintos entre sí sin motivo — uno decía "entrá al enlace de abajo" y el
 * otro "desde el enlace de abajo".
 *
 * Acá cada flujo es una línea de texto. Cambiar lo que dice el bot es editar
 * una cadena; agregar un flujo es agregar una entrada. Nadie tiene que
 * entender el armado para tocar la redacción.
 *
 * ── Están escritas para continuar después del nombre ───────────────────────
 *
 * "para solicitar tu turno, ..." — en minúscula y sin punto inicial. Eso deja
 * que `textoDelEnlace` arme las dos formas con la misma plantilla:
 *
 *   con nombre:  "Nicolas, para solicitar tu turno, utilizá el botón..."
 *   sin nombre:  "Para solicitar tu turno, utilizá el botón..."
 *
 * La alternativa —dos plantillas por flujo— se desincroniza al primer cambio:
 * alguien corrige una y se olvida de la otra.
 *
 * ── La restricción que no se puede romper ──────────────────────────────────
 *
 * Ninguna plantilla puede contener "asistente virtual" ni "bienvenid".
 * `presentarSiCorresponde` busca justamente eso para decidir si el mensaje ya
 * se presenta solo; si lo encuentra, no antepone la presentación y el primer
 * mensaje del día queda sin saludo. Ya pasó una vez, con los textos de archivo
 * entrante. Hay un test que lo verifica.
 */
export const PLANTILLAS_DEL_ENLACE: Record<IntencionDelPortal, string> = {
  nuevo_turno: "para solicitar tu turno, utilizá el botón que aparece a continuación.",
  familiar: "para solicitar el turno de tu familiar, utilizá el botón que aparece a continuación.",
  reagendar: "para reagendar tu turno{cuando}, utilizá el botón que aparece a continuación.",
  // ── El texto más delicado de los cuatro (25/9/2026) ──────────────────────
  //
  // Antes, tocar "Cancelar turno" traía un "confirmá tu decisión" que dejaba
  // clarísimo que todavía no había pasado nada. Con un enlace, el riesgo es
  // que el paciente lo lea como "listo, cancelado", no lo abra, y falte sin
  // avisar — o peor, se presente a un turno que cree cancelado.
  //
  // Por eso el mensaje abre diciendo que el turno SIGUE ACTIVO, antes de
  // mencionar el botón. El orden importa: si la aclaración va al final,
  // compite con el botón, que es lo que el ojo busca primero.
  cancelar: "tu turno{cuando} sigue activo. Para cancelarlo o cambiarlo de horario, usá el botón de acá abajo.",
}

/**
 * El primer nombre, presentable.
 *
 * El sistema de la clínica manda "DE SANTIAGO, Nicolas" o "NICOLAS" según el
 * campo, y escribirle "Hola NICOLAS" a alguien parece un grito. Se toma sólo el
 * primer nombre —"Nicolas, para solicitar..." y no "Nicolas De Santiago,
 * para..."— porque el nombre completo en un saludo suena a carta de un banco.
 *
 * Devuelve `null` si no hay nada usable, para que el llamador no tenga que
 * distinguir entre vacío y basura.
 */
export function primerNombrePresentable(nombre?: string | null): string | null {
  const limpio = String(nombre || "").trim().replace(/\s+/g, " ")
  if (!limpio) return null

  // "DE SANTIAGO, Nicolas" → el nombre está después de la coma.
  const primero = (limpio.includes(",") ? limpio.split(",")[1] : limpio).trim().split(" ")[0]
  if (!primero || primero.length < 2) return null
  if (!/\p{L}/u.test(primero)) return null

  return primero.charAt(0).toUpperCase() + primero.slice(1).toLowerCase()
}

export interface DatosDelTexto {
  intencion: IntencionDelPortal
  /** Nombre del paciente, si lo sabemos. Sin él el mensaje sigue siendo correcto. */
  nombre?: string | null
  /** Sólo para reagendar/cancelar: el turno del que se habla. */
  turno?: { fechaFormateada?: string; horaFormateada?: string }
  /**
   * Redacción propia de este cliente, si la tiene cargada. Se usa tal cual,
   * con los mismos marcadores que las plantillas de arriba.
   */
  plantilla?: string | null
}

/**
 * Arma el mensaje que acompaña al botón.
 *
 * El texto es corto a propósito. El mensaje ya lleva un botón que dice qué
 * hacer; sumarle un párrafo explicando el portal y otro ofreciendo ayuda por
 * chat le agrega ruido a algo que se resuelve con un toque. Si el paciente
 * prefiere escribir, escribe: no hace falta invitarlo.
 */
export function textoDelEnlace(datos: DatosDelTexto): string {
  const plantilla = (datos.plantilla || "").trim() || PLANTILLAS_DEL_ENLACE[datos.intencion]

  const cuando =
    datos.turno?.fechaFormateada && datos.turno?.horaFormateada
      ? ` del ${datos.turno.fechaFormateada} a las ${datos.turno.horaFormateada}`
      : ""

  const nombre = primerNombrePresentable(datos.nombre)

  const cuerpo = plantilla
    .replace(/\{cuando\}/g, cuando)
    // `{nombre}` se acepta por si una redacción propia lo pone en otro lugar
    // ("Tu turno, {nombre}, ..."). Cuando no lo usa, el nombre va adelante.
    .replace(/\{nombre\}/g, nombre || "")
    // Un marcador que se reemplaza por nada deja el hueco y la puntuación que
    // lo rodeaba: "Hola {nombre}: tu turno" sin nombre daba "Hola : tu turno".
    // No es un detalle cosmético — es el mensaje que ve un paciente que ya se
    // siente mal atendido si el bot le escribe mal.
    .replace(/\s+([,;:.!?])/g, "$1")
    // Y cuando el marcador estaba ENTRE signos —"Tu turno, {nombre}, se
    // saca"— quedan los dos pegados: "Tu turno,, se saca".
    .replace(/([,;:])\s*[,;:]/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim()

  if (nombre && !plantilla.includes("{nombre}")) {
    return `${nombre}, ${cuerpo}`
  }

  // Sin nombre la plantilla arranca la oración, así que le toca la mayúscula.
  return cuerpo.charAt(0).toUpperCase() + cuerpo.slice(1)
}

/**
 * Lo que recibe el paciente cuando su turno NO se puede reprogramar solo
 * (23/9/2026).
 *
 * Se le dice qué turno es y qué tiene que hacer. No se le pide disculpas por
 * una limitación de la clínica ni se le explica el flag: "no admite
 * reagendamiento" es vocabulario nuestro, no suyo.
 *
 * El teléfono sale del Número de Derivación de la config, con `fraseDerivacion`
 * — el mismo helper que usa el resto del sistema, para que el paciente no vea
 * dos formatos distintos del mismo número según por dónde entró.
 */
export function textoSoloPorTelefono(
  turno: { fechaFormateada?: string; horaFormateada?: string; profesional?: string } | undefined,
  escalationPhoneNumber?: string | null,
): string {
  let texto = "Tu turno"
  if (turno?.profesional) texto += ` con ${turno.profesional}`
  if (turno?.fechaFormateada) texto += ` del ${turno.fechaFormateada}`
  if (turno?.horaFormateada) texto += ` a las ${turno.horaFormateada}`
  texto += " no se puede reprogramar desde acá.\n\n"

  return texto + fraseDerivacion("Para cambiarlo, comunicate con la clínica", escalationPhoneNumber)
}

export const BOTON_REPROGRAMAR = "Elegir horario"
/** Máximo 20 caracteres, como todos los CTA. */
export const BOTON_GESTIONAR = "Gestionar mi turno"
export const BOTON_TURNO_NUEVO = "Sacar turno"
