/**
 * La fecha de un turno, escrita como la lee una persona (30/9/2026).
 *
 * Vive en su propio módulo porque la usan los dos lados del portal: el texto
 * del mensaje de WhatsApp y las tarjetas de la pantalla. Estaba en
 * `mensaje-enlace.ts`, y que un componente tuviera que importar el armador de
 * mensajes de WhatsApp para formatear una fecha era la señal de que estaba en
 * el lugar equivocado.
 */

import { formatDateWithDayOfWeek } from "../utils/date-utils"

/**
 * "2026-09-26" → "sábado, 26 de septiembre de 2026".
 *
 * Se prefiere `fecha` cruda porque es la que el formateador sabe leer.
 * `fechaFormateada` llega como "26/09/2026" y se reordena antes de pasarla: si
 * se la diera cruda a `new Date`, en Argentina saldría el mes cambiado por el
 * día —"09/10/2026" se leería como 9 de octubre—.
 *
 * Si nada se puede formatear, devuelve lo que haya. Un paciente prefiere
 * "26/09/2026" antes que un hueco donde iba la fecha de su turno.
 */
export function fechaPresentable(turno?: { fecha?: string; fechaFormateada?: string }): string {
  const cruda = (turno?.fecha || "").trim()
  const mostrada = (turno?.fechaFormateada || "").trim()

  if (/^\d{4}-\d{2}-\d{2}/.test(cruda)) return formatDateWithDayOfWeek(cruda.slice(0, 10))

  const ddmmaaaa = mostrada.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (ddmmaaaa) {
    const [, d, m, a] = ddmmaaaa
    return formatDateWithDayOfWeek(`${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`)
  }

  // El formateador ya devolvió algo legible (el `fecha_formateada` de la
  // clínica suele venir así), o no hay con qué: en los dos casos se muestra.
  if (/^\d{4}-\d{2}-\d{2}/.test(mostrada)) return formatDateWithDayOfWeek(mostrada.slice(0, 10))

  return mostrada || cruda
}

/** Lo mismo, con la primera letra en mayúscula: "Sábado, 26 de septiembre…". */
export function fechaPresentableEnMayuscula(turno?: {
  fecha?: string
  fechaFormateada?: string
}): string {
  const texto = fechaPresentable(turno)
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto
}
