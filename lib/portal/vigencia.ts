/**
 * Cuánto vive un enlace del portal, y qué deja hacer en cada momento
 * (22/9/2026).
 *
 * ── Dos relojes, no uno ────────────────────────────────────────────────────
 *
 * Un enlace tiene dos vencimientos distintos y confundirlos sale caro:
 *
 *  - **Vencimiento de acción**: hasta cuándo se puede reprogramar o cancelar.
 *    Corto, porque es la única protección real que controlamos nosotros. Una
 *    URL queda en el historial del navegador, se puede copiar de la barra de
 *    direcciones, sobrevive en una computadora compartida — cosas que una
 *    conversación de WhatsApp no hace.
 *
 *  - **Vencimiento de visibilidad**: hasta cuándo se puede VER qué pasó. Más
 *    largo, porque el paciente vuelve a abrir el enlace para chequear que su
 *    turno quedó bien. Si ahí le apareciera "enlace inválido" entendería que
 *    algo falló, y terminaría escribiéndole al bot para preguntar — un mensaje
 *    que pagamos y que no debería existir.
 *
 * Pasada la visibilidad se deja de mostrar el turno. Si el resultado quedara
 * visible para siempre, esa URL sería una ventana permanente al turno de esa
 * persona.
 *
 * ── Por qué no hay segundo factor ──────────────────────────────────────────
 *
 * Se evaluó pedir los últimos dígitos del DNI y se descartó. Hoy, cualquiera
 * que pueda leer el WhatsApp del paciente puede escribirle al bot y cancelarle
 * el turno sin que se le pregunte nada: el teléfono ES la credencial. Poner una
 * barrera en el portal mientras la puerta conversacional sigue abierta no
 * agrega seguridad, agrega fricción — y empuja a la gente de vuelta al camino
 * caro.
 *
 * Además, con población mayor es habitual que un hijo maneje el WhatsApp de la
 * madre. Esa persona no es un atacante: es quien hace el trámite.
 */

export type IntencionDelPortal = "reagendar" | "cancelar" | "nuevo_turno" | "familiar"

/** De dónde salió el enlace. Define cuánto dura la ventana para gestionar. */
export type OrigenDelEnlace = "recordatorio" | "conversacion"

export type EstadoDelEnlace =
  /** Se puede gestionar. */
  | "vigente"
  /** Ya se gestionó: se muestra el resultado, sin botones. */
  | "gestionado"
  /** Pasó la ventana para gestionar, pero todavía se puede ver el turno. */
  | "vencido_para_gestionar"
  /** Pasó todo: no se muestra ningún dato. */
  | "vencido"

const MINUTO = 60 * 1000
const HORA = 60 * MINUTO
const DIA = 24 * HORA

/**
 * El enlace que sale de una conversación se abre enseguida: el paciente está
 * escribiendo en ese momento. Media hora es holgado.
 */
export const VENTANA_CONVERSACION_MS = 30 * MINUTO

/**
 * El de un recordatorio puede abrirse mucho después — el recordatorio sale con
 * horas de anticipación. El tope existe para que un enlace no quede vivo
 * indefinidamente si el turno es dentro de un mes.
 */
export const TOPE_RECORDATORIO_MS = 48 * HORA

/** Cuando no hay un turno con fecha (pedir uno nuevo), el resultado se ve una semana. */
export const VISIBILIDAD_SIN_TURNO_MS = 7 * DIA

export interface Vencimientos {
  /** ISO. Hasta acá se puede gestionar. */
  venceAccion: string
  /** ISO. Hasta acá se puede ver el resultado. Siempre ≥ venceAccion. */
  venceVisibilidad: string
}

/**
 * Calcula los dos vencimientos.
 *
 * `fechaDelTurno` en ISO cuando el enlace es sobre un turno existente. La
 * visibilidad llega hasta ahí: pasada la consulta, esa información ya no le
 * sirve a nadie.
 */
export function calcularVencimientos(params: {
  origen: OrigenDelEnlace
  fechaDelTurno?: string | null
  ahora?: number
}): Vencimientos {
  const ahora = params.ahora ?? Date.now()

  const turno = fechaValida(params.fechaDelTurno)

  let accion: number
  if (params.origen === "conversacion") {
    accion = ahora + VENTANA_CONVERSACION_MS
  } else {
    const tope = ahora + TOPE_RECORDATORIO_MS
    // Hasta el turno, sin pasarse del tope. Y nunca menos que la ventana
    // conversacional: un recordatorio que llega una hora antes del turno tiene
    // que dejar gestionar igual.
    accion = turno ? Math.min(turno, tope) : tope
    accion = Math.max(accion, ahora + VENTANA_CONVERSACION_MS)
  }

  // La visibilidad nunca puede ser menor que la acción: sería poder gestionar
  // algo cuyo resultado no se puede ver.
  const visibilidad = Math.max(accion, turno ?? ahora + VISIBILIDAD_SIN_TURNO_MS)

  return {
    venceAccion: new Date(accion).toISOString(),
    venceVisibilidad: new Date(visibilidad).toISOString(),
  }
}

/**
 * En qué estado está el enlace.
 *
 * `gestionado` gana sobre los vencimientos mientras haya visibilidad: al
 * paciente que ya reprogramó le importa ver qué le quedó, no que el plazo para
 * volver a hacerlo haya pasado.
 */
export function estadoDelEnlace(
  contexto: { venceAccion: string; venceVisibilidad: string; resultado?: unknown },
  ahora: number = Date.now(),
): EstadoDelEnlace {
  const accion = fechaValida(contexto.venceAccion) ?? 0
  const visibilidad = fechaValida(contexto.venceVisibilidad) ?? 0

  if (ahora > visibilidad) return "vencido"
  if (contexto.resultado) return "gestionado"
  if (ahora > accion) return "vencido_para_gestionar"
  return "vigente"
}

/** true si en este estado se pueden tocar los turnos del paciente. */
export function permiteGestionar(estado: EstadoDelEnlace): boolean {
  return estado === "vigente"
}

/** true si en este estado se pueden mostrar los datos del turno. */
export function permiteVerDatos(estado: EstadoDelEnlace): boolean {
  return estado !== "vencido"
}

function fechaValida(valor?: string | null): number | null {
  if (!valor) return null
  const t = new Date(valor).getTime()
  return Number.isFinite(t) ? t : null
}
