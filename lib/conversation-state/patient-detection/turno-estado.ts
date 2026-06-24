/**
 * Clasificación del estado de un turno devuelto por get_paciente (turnos_proximos).
 *
 * Semántica de negocio:
 *  - "Confirmado"               → el paciente YA confirmó su asistencia.
 *  - "No confirmado"            → el turno existe pero el PACIENTE aún no confirmó
 *                                 su asistencia (puede confirmarla desde el chatbot).
 *  - "Pendiente de aprobación"  → el turno está pendiente de aprobación por parte de
 *                                 la clínica (el paciente NO puede confirmar asistencia).
 *
 * Cualquier estado no reconocido se trata, de forma conservadora, como
 * "Pendiente de aprobación".
 */
export type TurnoEstadoCategoria = 'confirmado' | 'no_confirmado' | 'pendiente_aprobacion'

/**
 * Devuelve el estado crudo del turno normalizado (lowercase, trim).
 */
export function getTurnoEstadoRaw(turno: any): string {
  return String(turno?.Estado ?? turno?.estado ?? '')
    .trim()
    .toLowerCase()
}

/**
 * Clasifica el estado de un turno en una de las tres categorías de negocio.
 */
export function classifyTurnoEstado(turno: any): TurnoEstadoCategoria {
  const estado = getTurnoEstadoRaw(turno)

  if (estado === 'confirmado') return 'confirmado'
  if (estado === 'no confirmado') return 'no_confirmado'

  // "pendiente de aprobación" y cualquier otro estado desconocido se
  // tratan como pendientes de aprobación por la clínica.
  return 'pendiente_aprobacion'
}

/**
 * ¿Debe ofrecerse la opción "Confirmar asistencia" para este turno?
 *
 * Solo cuando el turno está en estado "No confirmado" — es decir, el paciente
 * TODAVÍA NO confirmó su asistencia y puede hacerlo.
 *
 * No se ofrece cuando:
 *  - "Confirmado": el paciente ya confirmó, mostrar de nuevo confundiría.
 *  - "Pendiente de aprobación": la clínica todavía no aprobó el turno.
 */
export function shouldOfferConfirmation(turno: any): boolean {
  const categoria = classifyTurnoEstado(turno)
  return categoria === 'no_confirmado'
}
