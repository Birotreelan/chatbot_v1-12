/**
 * Patient Detection Flow - Message Templates
 * Mensajes personalizados para el flujo de detección inicial
 */

/**
 * Formatea la información del paciente existente
 * Saludo personalizado + resumen de turnos próximos
 */
export function buildExistingPatientGreeting(
  patientName: string,
  turnos: any[]
): string {
  const firstName = patientName.split(' ')[0]

  if (!turnos || turnos.length === 0) {
    return `¡Hola ${firstName}! 👋\n\nNo tienes turnos agendados actualmente. ¿En qué puedo ayudarte?\n\n1️⃣ Agendar un turno\n2️⃣ Consultar disponibilidad\n3️⃣ Otra consulta\n4️⃣ Más tarde`
  }

  // Obtener próximo turno
  const proximoTurno = turnos[0]
  const fecha = formatearFecha(proximoTurno.fecha)
  const hora = proximoTurno.hora || proximoTurno.turno_hora || 'sin horario'
  const profesional =
    proximoTurno.nombre_profesional ||
    proximoTurno.profesional_nombre ||
    'profesional'

  let message = `¡Hola ${firstName}! 👋\n\n`
  message += `Tu próximo turno es:\n`
  message += `📅 ${fecha} a las ${hora}\n`
  message += `👨‍⚕️ ${profesional}\n\n`

  if (turnos.length > 1) {
    message += `Tienes ${turnos.length} turno(s) agendado(s).\n\n`
  }

  message += `¿Qué deseas hacer?\n\n`
  message += `1️⃣ Confirmar turno\n`
  message += `2️⃣ Cancelar turno\n`
  message += `3️⃣ Agendar otro turno\n`
  message += `4️⃣ Otra consulta`

  return message
}

/**
 * Saludo para paciente nuevo (no encontrado)
 */
export function buildNewPatientGreeting(): string {
  return (
    `¡Hola! 👋\n\n` +
    `Bienvenido a nuestro centro. Para continuar, necesito tu número de DNI para verificar tu información.\n\n` +
    `Por favor, ingresa tu DNI (sin puntos ni espacios).\n\n` +
    `Ejemplo: 12345678`
  )
}

/**
 * Mensaje cuando se selecciona una opción válida
 */
export function buildSelectionConfirmation(
  selection: number,
  patientName?: string
): string {
  const firstName = patientName
    ? patientName.split(' ')[0]
    : 'Vale'

  const messages: Record<number, string> = {
    1: `${firstName}, vamos a confirmar tu turno. Un momento...`,
    2: `Entendido, vamos a cancelar tu turno. Un momento...`,
    3: `Perfecto, vamos a agendar un nuevo turno. Un momento...`,
    4: `Claro, ¿en qué más puedo ayudarte?`,
  }

  return messages[selection] || `Procesando tu solicitud...`
}

/**
 * Mensaje de error cuando la selección es inválida
 */
export function buildInvalidSelectionMessage(): string {
  return (
    `No entendí tu respuesta. Por favor, selecciona una opción:\n\n` +
    `1️⃣ Confirmar turno\n` +
    `2️⃣ Cancelar turno\n` +
    `3️⃣ Agendar otro turno\n` +
    `4️⃣ Otra consulta`
  )
}

/**
 * Mensaje cuando hay error al detectar al paciente
 */
export function buildDetectionErrorMessage(): string {
  return (
    `Parece que hay un problema temporal en nuestro sistema. ` +
    `Por favor, dame tu número de DNI para continuar.\n\n` +
    `Ejemplo: 12345678`
  )
}

/**
 * Mensaje de resumen de turnos cuando hay múltiples
 */
export function buildTurnosSummary(turnos: any[]): string {
  if (!turnos || turnos.length === 0) {
    return `No tienes turnos agendados.`
  }

  let message = `📋 **Tus turnos agendados:**\n\n`

  turnos.slice(0, 5).forEach((turno: any, idx: number) => {
    const fecha = formatearFecha(turno.fecha)
    const hora = turno.hora || turno.turno_hora || 'sin horario'
    const profesional =
      turno.nombre_profesional || turno.profesional_nombre || 'profesional'

    message += `${idx + 1}. ${fecha} - ${hora}\n`
    message += `   ${profesional}\n`
  })

  if (turnos.length > 5) {
    message += `\n... y ${turnos.length - 5} más`
  }

  return message
}

/**
 * Helper: Formatea fecha para mensajes
 */
function formatearFecha(fecha: string | Date): string {
  try {
    const date = typeof fecha === 'string' ? new Date(fecha) : fecha

    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }

    return new Intl.DateTimeFormat('es-ES', options).format(date)
  } catch {
    return fecha.toString()
  }
}

/**
 * Mensaje cuando el usuario debe esperar (procesamiento)
 */
export function buildProcessingMessage(): string {
  return `Un momento, estoy procesando tu solicitud...`
}

/**
 * Mensaje cuando se requiere más información
 */
export function buildMoreInfoRequestMessage(): string {
  return (
    `Necesito un poco más de información. ` +
    `¿Podrías especificar qué necesitas? ` +
    `(confirmar turno, cancelar, agendar, etc.)`
  )
}
