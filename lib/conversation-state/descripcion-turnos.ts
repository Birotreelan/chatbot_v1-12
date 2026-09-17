/**
 * Descripción en texto de los turnos que tiene el paciente (17/9/2026).
 *
 * ── Los dos problemas que resuelve ─────────────────────────────────────────
 *
 * Caso real (Marcela, recordatorio `confirmacion_2_turno` del 17/9): la clínica
 * le avisó de DOS turnos el mismo día —08:25 con Departamento de Estudios y
 * 08:30 con Traverso Alvarado—. Ella preguntó si podía cambiarlos y el bot
 * respondió:
 *
 *   "Veo que tenés un turno programado para el sábado 19 a las 08:25:00
 *    con DEPARTAMENTO DE ESTUDIOS"
 *
 * Dos defectos en una línea:
 *
 *  1. `extractTurnoData` tomaba `turnos[0]` y descartaba el resto. El segundo
 *     turno desaparecía de la conversación. Y no es un detalle cosmético: la
 *     confirmación y la cancelación se mandan al proxy POR FECHA, no por id de
 *     turno, así que la acción alcanza a los dos. Nombrar uno solo le oculta al
 *     paciente qué está por pasar.
 *
 *  2. La hora salía cruda del backend, con segundos: "08:25:00".
 */

export interface TurnoDescribible {
  fecha?: string
  fecha_formateada?: string
  hora?: string
  hora_formateada?: string
  profesional?: string
  sede?: string
}

/** "08:25:00" → "08:25". Deja intacto lo que ya viene bien o no reconoce. */
export function formatearHora(hora?: string | null): string {
  const texto = (hora || "").trim()
  if (!texto) return ""
  const match = texto.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!match) return texto
  return `${match[1].padStart(2, "0")}:${match[2]}`
}

/** Los turnos del contexto, en la forma que venga (ChatbotData o campos sueltos). */
export function turnosDelContexto(appointmentContext: any): TurnoDescribible[] {
  if (Array.isArray(appointmentContext?.turnos) && appointmentContext.turnos.length > 0) {
    return appointmentContext.turnos
  }
  // Compatibilidad con contextos viejos que traían los campos en la raíz.
  if (appointmentContext?.fecha || appointmentContext?.appointment_date) {
    return [
      {
        fecha: appointmentContext.fecha || appointmentContext.appointment_date,
        hora: appointmentContext.hora || appointmentContext.appointment_time,
        profesional: appointmentContext.profesional,
        sede: appointmentContext.sede,
      },
    ]
  }
  return []
}

/**
 * Describe los turnos para intercalar en un mensaje.
 *
 * `formatearFecha` se inyecta para no acoplar este módulo al formateador de
 * fechas del llamador (cada capa usa el suyo).
 *
 * Con un turno devuelve una frase; con varios, una lista. Nunca calla ninguno.
 */
export function describirTurnos(
  appointmentContext: any,
  formatearFecha: (fecha: string) => string,
): string | null {
  const turnos = turnosDelContexto(appointmentContext)
  if (turnos.length === 0) return null

  const datos = turnos.map((t) => ({
    fecha: t.fecha || t.fecha_formateada || "",
    hora: formatearHora(t.hora || t.hora_formateada),
    profesional: (t.profesional || "").trim(),
    sede: (t.sede || "").trim(),
  }))

  if (datos.length === 1) {
    const t = datos[0]
    const partes = [
      `un turno programado para el *${t.fecha ? formatearFecha(t.fecha) : "fecha no disponible"}*`,
      ` a las *${t.hora || "hora no disponible"}*`,
      t.profesional ? ` con ${t.profesional}` : "",
      t.sede ? ` en ${t.sede}` : "",
    ]
    return partes.join("")
  }

  // Varios turnos. Si comparten fecha o sede —el caso habitual: estudios previos
  // a la consulta— se dicen una sola vez y no se repiten en cada línea.
  const fechas = new Set(datos.map((t) => t.fecha).filter(Boolean))
  const sedes = new Set(datos.map((t) => t.sede).filter(Boolean))
  const mismaFecha = fechas.size === 1
  const mismaSede = sedes.size === 1

  const encabezado = [
    `*${datos.length} turnos* programados`,
    mismaFecha ? ` para el *${formatearFecha(datos[0].fecha)}*` : "",
    mismaSede ? ` en ${datos[0].sede}` : "",
    ":",
  ].join("")

  const lineas = datos.map((t) => {
    const partes = [
      "  • ",
      mismaFecha ? "" : `${t.fecha ? formatearFecha(t.fecha) : "fecha no disponible"}, `,
      `*${t.hora || "hora no disponible"}*`,
      t.profesional ? ` — ${t.profesional}` : "",
      mismaSede || !t.sede ? "" : ` (${t.sede})`,
    ]
    return partes.join("")
  })

  return `${encabezado}\n\n${lineas.join("\n")}`
}

/**
 * ¿Hay más de un turno? Las opciones del menú tienen que hablar en plural:
 * confirmar o cancelar alcanza a todos los del día, no a uno.
 */
export function hayVariosTurnos(appointmentContext: any): boolean {
  return turnosDelContexto(appointmentContext).length > 1
}
