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
 * Sí cuando el turno está confirmado (ya confirmado) o "No confirmado"
 * (el paciente todavía puede confirmar su asistencia).
 * No cuando está pendiente de aprobación por la clínica.
 */
export function shouldOfferConfirmation(turno: any): boolean {
  const categoria = classifyTurnoEstado(turno)
  return categoria === 'confirmado' || categoria === 'no_confirmado'
}
