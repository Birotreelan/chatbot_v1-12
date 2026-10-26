/**
 * El comentario que viaja en `set_turno` cuando el turno es un reagendamiento
 * (26/10/2026).
 *
 * ── Para qué ───────────────────────────────────────────────────────────────
 *
 * `set_turno` acepta `Comentarios`, y hasta hoy nadie lo completaba. El sistema
 * de la clínica recibe un turno nuevo y otro cancelado minutos antes, sin nada
 * que los relacione: tiene que deducir a ojo que uno reemplaza al otro. El
 * comentario lo dice.
 *
 * ── Por qué un texto y no un id ────────────────────────────────────────────
 *
 * Porque no tenemos id de turno. En todo el proyecto el turno se identifica por
 * fecha, hora y profesional: `cancelar_turno` ni siquiera acepta la hora, cancela
 * por FECHA y DNI. Lo único parecido a un identificador que manejamos es el
 * `agenda_id`, que es del hueco de agenda y no del turno, pero sirve para que
 * del otro lado puedan ubicarlo. Va todo junto en la frase.
 *
 * ── Por qué legible y no clave=valor ───────────────────────────────────────
 *
 * Decidido con Nicolás el 26/10/2026: del otro lado lo lee una persona en la
 * ficha del turno, no lo parsea un proceso. Un `[REAGENDA fecha=... hora=...]`
 * sería más cómodo para nosotros y peor para quien lo tiene que leer.
 *
 * ── Qué pasa cuando faltan datos ───────────────────────────────────────────
 *
 * El snapshot del turno cancelado puede venir incompleto —viene de
 * `Chatbot_Data`, que no siempre trae profesional o agenda—. Cada pedazo que
 * falta se omite en vez de escribir "undefined" en la ficha de un paciente. Si
 * no queda nada más que la fecha de la cancelación, el comentario igual se
 * manda: decir "esto reemplaza a un turno cancelado" ya es más de lo que hay
 * hoy.
 */

/**
 * El turno que se canceló, como lo guarda el snapshot de Redis
 * (`ChatbotDataTurnoCancelado`) o como lo tiene a mano el flujo que reagenda.
 *
 * Todo opcional a propósito: los tres orígenes traen conjuntos distintos y
 * exigir campos obligaría a los llamadores a inventar valores.
 */
export interface TurnoCanceladoParaComentario {
  /** "2026-09-29" o "29/09/2026", las dos formas circulan en el proyecto. */
  fecha?: string
  /** "09:30" o "09:30:00". */
  hora?: string
  profesional?: string
  /** El hueco de agenda del turno cancelado, lo más cercano a un id que hay. */
  agendaId?: string
  sede?: string
}

/** De dónde salió la cancelación. Lo lee una persona, así que va en castellano. */
export type OrigenDelReagendamiento = "whatsapp" | "portal" | "chat" | "desconocido"

const COMO_LLEGO: Record<OrigenDelReagendamiento, string> = {
  whatsapp: " por el paciente desde WhatsApp",
  portal: " por el paciente desde el portal web",
  chat: " por el paciente desde el chat del enlace",
  desconocido: "",
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

/**
 * "2026-09-29" → "29/09/2026". Lo que no reconoce lo devuelve tal cual.
 *
 * No usa `new Date`: "2026-09-29" se interpreta como UTC y en Argentina
 * retrocede un día. Ese error ya aparece en otras partes del proyecto y no
 * conviene sumarle otra.
 */
export function fechaLegible(fecha?: string): string {
  if (!fecha) return ""
  const iso = fecha.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`
  const arg = fecha.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (arg) return arg[0]
  return fecha.trim()
}

/** "09:30:00" → "09:30". */
export function horaLegible(hora?: string): string {
  if (!hora) return ""
  const m = hora.match(/^(\d{1,2}):(\d{2})/)
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : hora.trim()
}

/** "2026-10-26T18:10:33.000Z" → "26 de octubre de 2026 a las 15:10" (hora de Argentina). */
function momentoLegible(iso?: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  try {
    const partes = new Intl.DateTimeFormat("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      day: "numeric",
      month: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d)
    const p: Record<string, string> = {}
    partes.forEach((x) => (p[x.type] = x.value))
    return `${p.day} de ${MESES[Number(p.month) - 1]} de ${p.year} a las ${p.hour}:${p.minute}`
  } catch {
    return ""
  }
}

export interface DatosDelReagendamiento {
  turnoCancelado?: TurnoCanceladoParaComentario | null
  /** Cuándo se canceló. ISO. */
  canceladoEl?: string | null
  origen?: OrigenDelReagendamiento
}

/**
 * El texto para `Comentarios`. Cadena vacía si no hay nada que decir — los
 * llamadores ya saben no mandar el campo cuando está vacío.
 *
 * Ejemplos de lo que produce:
 *
 *   Reagendamiento del turno del 29/09/2026 09:30 hs con Dr. Pérez
 *   (agenda 12345), cancelado el 28 de septiembre de 2026 a las 18:10 por el
 *   paciente desde WhatsApp.
 *
 *   Reagendamiento del turno del 29/09/2026, cancelado por el paciente desde
 *   el portal web.
 *
 *   Reagendamiento de un turno cancelado el 28 de septiembre de 2026 a las
 *   18:10.
 */
export function comentarioDeReagendamiento(datos: DatosDelReagendamiento): string {
  const t = datos.turnoCancelado
  const fecha = fechaLegible(t?.fecha)
  const hora = horaLegible(t?.hora)
  const profesional = t?.profesional?.trim()
  const agenda = t?.agendaId ? String(t.agendaId).trim() : ""
  const cuando = momentoLegible(datos.canceladoEl || undefined)
  const como = COMO_LLEGO[datos.origen || "desconocido"]

  // Sin fecha del turno no se puede decir CUÁL era: queda la versión corta.
  if (!fecha) {
    if (!cuando && !como) return ""
    const cola = [cuando ? ` el ${cuando}` : "", como].join("")
    return `Reagendamiento de un turno cancelado${cola}.`.replace(/\s+/g, " ")
  }

  let turno = `Reagendamiento del turno del ${fecha}`
  if (hora) turno += ` ${hora} hs`
  if (profesional) turno += ` con ${profesional}`
  if (t?.sede?.trim()) turno += ` en ${t.sede.trim()}`
  if (agenda) turno += ` (agenda ${agenda})`

  // Sin momento ni origen, un ", cancelado" suelto no agrega nada: que el
  // turno viejo está cancelado ya se entiende de "Reagendamiento del turno".
  const cancelacion = cuando || como
    ? [", cancelado", cuando ? ` el ${cuando}` : "", como].join("")
    : ""

  return `${turno}${cancelacion}.`.replace(/\s+/g, " ")
}
