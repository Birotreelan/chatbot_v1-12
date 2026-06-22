/**
 * Patient Detection Flow - Message Templates
 * Mensajes personalizados para el flujo de deteccion inicial
 * 
 * IMPORTANTE: Estos mensajes siguen EXACTAMENTE el formato del asst_router.md
 * - NO usar "Hola [nombre]" al inicio (excepto primer mensaje de bienvenida)
 * - Usar "[nombre], [mensaje]" como formato estandar
 * - Usar tuteo argentino (vos, tenes, podes)
 * - Nombre de la clinica: parametrizable
 */

// Nombre de la clinica por defecto (se puede parametrizar)
const DEFAULT_CLINIC_NAME = 'Salud Ocular'

/**
 * Normaliza el nombre del paciente: Primera letra mayuscula, resto minuscula
 * Ejemplo: "JUAN CARLOS" -> "Juan Carlos"
 */
function normalizeName(name: string): string {
  if (!name) return ''
  return name
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Extrae el primer nombre del paciente
 */
function getFirstName(fullName: string): string {
  const normalized = normalizeName(fullName)
  return normalized.split(' ')[0] || 'Paciente'
}

/**
 * Formatea fecha al estilo argentino
 * Ejemplo: "2026-05-29" -> "viernes, 29 de mayo de 2026"
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
    return new Intl.DateTimeFormat('es-AR', options).format(date)
  } catch {
    return fecha.toString()
  }
}

/**
 * Formatea hora: "14:30:00" -> "14:30"
 */
function formatearHora(hora: string): string {
  if (!hora) return ''
  const parts = hora.split(':')
  return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : hora
}

/**
 * Formatea nombre del profesional
 * Ejemplo: "LOPEZ, Martin Alejandro" -> "Dr/Dra. Lopez, Martin Alejandro"
 */
function formatearProfesional(nombre: string): string {
  if (!nombre) return 'el profesional'
  return normalizeName(nombre)
}

/**
 * Saludo para PACIENTE EXISTENTE CON TURNOS
 * Formato exacto del asst_router
 */
export function buildExistingPatientGreeting(
  patientName: string,
  turnos: any[],
  clinicName: string = DEFAULT_CLINIC_NAME,
  turnosQx: any[] = []
): string {
  const firstName = getFirstName(patientName)
  const hasTurnos = turnos && turnos.length > 0
  const hasTurnosQx = turnosQx && turnosQx.length > 0

  // CASO: Solo cirugías (sin turnos médicos gestionables)
  if (!hasTurnos && hasTurnosQx) {
    return buildSoloCirugiaGreeting(firstName, turnosQx, clinicName)
  }

  // CASO: Sin turnos agendados
  if (!hasTurnos) {
    return buildExistingPatientNoTurnosGreeting(patientName, clinicName)
  }

  // CASO: Turnos médicos (con o sin cirugías)
  // Construir el saludo médico base y agregar sección de cirugías si corresponde
  let mensaje: string
  if (turnos.length === 1) {
    mensaje = buildSingleTurnoGreeting(firstName, turnos[0], clinicName)
  } else {
    mensaje = buildMultipleTurnosGreeting(firstName, turnos, clinicName)
  }

  // Si además hay cirugías, insertar bloque informativo antes del pie del menú
  if (hasTurnosQx) {
    mensaje = insertCirugiaBlock(mensaje, turnosQx)
  }

  return mensaje
}

/**
 * Inserta un bloque informativo de cirugías dentro de un saludo médico existente.
 * Se ubica antes de la última línea "Respondé con el número de opción que prefieras."
 */
function insertCirugiaBlock(mensajeBase: string, turnosQx: any[]): string {
  const bloqueCirugias = buildBloqueCirugias(turnosQx)
  const ancla = 'Respondé con el número de opción que prefieras.'
  const idx = mensajeBase.lastIndexOf(ancla)
  if (idx === -1) {
    // Si no encontramos la ancla, simplemente agregamos al final
    return mensajeBase + '\n\n' + bloqueCirugias
  }
  return mensajeBase.slice(0, idx) + bloqueCirugias + '\n\n' + mensajeBase.slice(idx)
}

/**
 * Construye el bloque de texto informativo sobre turnos quirúrgicos.
 */
function buildBloqueCirugias(turnosQx: any[]): string {
  let bloque = `_Además, registramos ${turnosQx.length === 1 ? 'un turno de cirugía agendado' : `${turnosQx.length} turnos de cirugía agendados`}:_\n\n`

  turnosQx.forEach((qx, idx) => {
    const fecha = formatearFecha(qx.Fecha || qx.fecha)
    const hora = formatearHora(qx.Hora || qx.hora || '')
    const cirugiaName = normalizeName(
      qx.Cirugia_Nombre || qx.cirugia_nombre || qx.nombre_cirugia || qx.Descripcion || qx.descripcion || 'Cirugía'
    )
    const cirujano = formatearProfesional(
      qx.Profesional_Nombre || qx.profesional_nombre || qx.nombre_profesional || qx.Cirujano || qx.cirujano || ''
    )

    if (turnosQx.length > 1) {
      bloque += `${idx + 1}. Cirugía: ${cirugiaName}\n`
    } else {
      bloque += `Cirugía: ${cirugiaName}\n`
    }
    if (cirujano && cirujano !== 'el profesional') bloque += `Cirujano: ${cirujano}\n`
    bloque += `Fecha: ${fecha}${hora ? ` a las ${hora}` : ''}\n`
    if (idx < turnosQx.length - 1) bloque += '\n'
  })

  bloque += `\n_La gestión de turnos quirúrgicos debe realizarse comunicándote directamente con la clínica._\n\n`
  return bloque
}

/**
 * Saludo para paciente con SOLO turno(s) de cirugía (sin turnos médicos)
 * Los turnos quirúrgicos son solo informativos, no se pueden gestionar por este canal
 */
function buildSoloCirugiaGreeting(
  firstName: string,
  turnosQx: any[],
  clinicName: string
): string {
  let mensaje = `*${firstName}, ¡bienvenido de nuevo a ${clinicName}!*\n\n`
  mensaje += `Soy Iris, tu asistente virtual de inteligencia artificial. Por este canal podrás solicitar, consultar, confirmar asistencia o cancelar turnos médicos.\n\n`

  if (turnosQx.length === 1) {
    const qx = turnosQx[0]
    const fecha = formatearFecha(qx.Fecha || qx.fecha)
    const hora = formatearHora(qx.Hora || qx.hora || '')
    const cirugiaName = qx.Cirugia_Nombre || qx.cirugia_nombre || qx.nombre_cirugia || qx.Descripcion || qx.descripcion || 'cirugía'
    const cirujano = formatearProfesional(
      qx.Profesional_Nombre || qx.profesional_nombre || qx.nombre_profesional || qx.Cirujano || qx.cirujano || ''
    )

    mensaje += `*Veo que tenés un turno de cirugía agendado:*\n\n`
    mensaje += `Cirugía: ${normalizeName(cirugiaName)}\n`
    if (cirujano && cirujano !== 'el profesional') mensaje += `Cirujano: ${cirujano}\n`
    mensaje += `Fecha: ${fecha}${hora ? ` a las ${hora}` : ''}\n\n`
  } else {
    mensaje += `*Veo que tenés ${turnosQx.length} turnos de cirugía agendados:*\n\n`
    turnosQx.forEach((qx, idx) => {
      const fecha = formatearFecha(qx.Fecha || qx.fecha)
      const hora = formatearHora(qx.Hora || qx.hora || '')
      const cirugiaName = qx.Cirugia_Nombre || qx.cirugia_nombre || qx.nombre_cirugia || qx.Descripcion || qx.descripcion || 'cirugía'
      const cirujano = formatearProfesional(
        qx.Profesional_Nombre || qx.profesional_nombre || qx.nombre_profesional || qx.Cirujano || qx.cirujano || ''
      )
      mensaje += `${idx + 1}. Cirugía: ${normalizeName(cirugiaName)}\n`
      if (cirujano && cirujano !== 'el profesional') mensaje += `   Cirujano: ${cirujano}\n`
      mensaje += `   Fecha: ${fecha}${hora ? ` a las ${hora}` : ''}\n\n`
    })
  }

  mensaje += `La gestión de turnos quirúrgicos (cancelación, modificación o confirmación) debe realizarse comunicándote directamente con la clínica.\n\n`
  mensaje += `¿En qué más te puedo ayudar?\n\n`
  mensaje += `1- Solicitar un turno médico\n`
  mensaje += `2- Solicitar turno para un familiar\n`
  mensaje += `3- Realizar otra consulta\n\n`
  mensaje += `Respondé con el número de opción que prefieras.`

  return mensaje
}

/**
 * Saludo para paciente existente SIN turnos agendados
 * Incluye opcion para solicitar turno para un familiar
 */
function buildExistingPatientNoTurnosGreeting(
  patientName: string,
  clinicName: string = DEFAULT_CLINIC_NAME
): string {
  const firstName = getFirstName(patientName)

  return (
    `*${firstName}, ¡bienvenido de nuevo a ${clinicName}!*\n\n` +
    `Soy Iris, tu asistente virtual de inteligencia artificial. Por este canal podrás solicitar, consultar, confirmar o cancelar turnos.\n\n` +
    `Veo que actualmente no tenés turnos agendados. ¿En qué te puedo ayudar?\n\n` +
    `1- Solicitar turno médico\n` +
    `2- Solicitar turno para un familiar\n` +
    `3- Realizar otra consulta\n\n` +
    `Por favor, respondé con el número de opción que prefieras.`
  )
}

/**
 * Mensaje solicitando el DNI del familiar
 */
export function buildFamiliarDNIRequestMessage(): string {
  return (
    `Por favor, indicame el *DNI del familiar* (7 u 8 dígitos, sin puntos ni espacios) ` +
    `para poder identificarlo en nuestro sistema.`
  )
}

/**
 * Saludo con UN solo turno
 */
function buildSingleTurnoGreeting(
  firstName: string,
  turno: any,
  clinicName: string
): string {
  const fecha = formatearFecha(turno.Fecha || turno.fecha)
  const hora = formatearHora(turno.Hora || turno.hora || '')
  const profesional = formatearProfesional(
    turno.Profesional_Nombre || turno.profesional_nombre || turno.nombre_profesional || ''
  )
  const sede = turno.Centro_Nombre || turno.sede || clinicName
  const estado = (turno.Estado || turno.estado || '').toLowerCase()
  const estaConfirmado = estado === 'confirmado'

  let mensaje = `*${firstName}, ¡bienvenido de nuevo a ${clinicName}!*\n\n`
  mensaje += `Soy Iris, tu asistente virtual de inteligencia artificial. Por este canal podrás solicitar, consultar, confirmar asistencia o cancelar turnos médicos.\n\n`

  if (estaConfirmado) {
    mensaje += `*Veo que ya tenés un turno médico agendado y con la asistencia confirmada para el ${fecha} a las ${hora} con ${profesional} en la sede ${sede}.*\n\n`
    mensaje += `¿En qué te podemos ayudar?\n\n`
    mensaje += `1- Confirmar asistencia al turno médico (ya confirmado)\n`
    mensaje += `2- Cancelar el turno médico confirmado\n`
    mensaje += `3- Cancelar el turno médico y solicitar uno nuevo\n`
    mensaje += `4- Realizar otra consulta\n\n`
  } else {
    mensaje += `*Veo que ya tenés un turno médico agendado para el ${fecha} a las ${hora} con ${profesional} en la sede ${sede}.*\n\n`
    mensaje += `¿En qué te podemos ayudar?\n\n`
    mensaje += `1- Confirmar asistencia al turno médico\n`
    mensaje += `2- Cancelar turno médico\n`
    mensaje += `3- Cancelar el turno médico y solicitar uno nuevo\n`
    mensaje += `4- Realizar otra consulta\n\n`
  }

  mensaje += `Respondé con el número de opción que prefieras.`

  return mensaje
}

/**
 * Saludo con MULTIPLES turnos
 */
function buildMultipleTurnosGreeting(
  firstName: string,
  turnos: any[],
  clinicName: string
): string {
  let mensaje = `*${firstName}, ¡bienvenido de nuevo a ${clinicName}!*\n\n`
  mensaje += `Soy Iris, tu asistente virtual de inteligencia artificial. Por este canal podrás solicitar, consultar, confirmar asistencia o cancelar turnos médicos.\n\n`
  mensaje += `*Veo que tenés ${turnos.length} turnos médicos agendados:*\n\n`

  turnos.forEach((turno, idx) => {
    const fecha = formatearFecha(turno.Fecha || turno.fecha)
    const hora = formatearHora(turno.Hora || turno.hora || '')
    const profesional = formatearProfesional(
      turno.Profesional_Nombre || turno.profesional_nombre || turno.nombre_profesional || ''
    )
    const estado = (turno.Estado || turno.estado || '').toLowerCase()
    const estadoTexto = estado === 'confirmado' ? ' ✓ Confirmado' : ''

    mensaje += `${idx + 1}. ${fecha} a las ${hora}\n`
    mensaje += `   ${profesional}${estadoTexto}\n\n`
  })

  mensaje += `¿En qué te podemos ayudar?\n\n`
  mensaje += `1- Confirmar asistencia a un turno\n`
  mensaje += `2- Cancelar un turno\n`
  mensaje += `3- Cancelar un turno y solicitar uno nuevo\n`
  mensaje += `4- Realizar otra consulta\n\n`
  mensaje += `Respondé con el número de opción que prefieras.`

  return mensaje
}

/**
 * Saludo para PACIENTE NO identificado (no encontrado por telefono)
 * Se solicita intención: turno o consulta
 */
export function buildNewPatientGreeting(
  clinicName: string = DEFAULT_CLINIC_NAME
): string {
  return (
    `*¡Bienvenido a ${clinicName}!*\n\n` +
    `Soy Iris, tu asistente virtual de inteligencia artificial.\n\n` +
    `Por favor indicame, ¿cuál es el motivo de tu contacto?\n\n` +
    `1- Solicitar un turno médico\n` +
    `2- Realizar otra consulta\n\n` +
    `Respondé con el *número* de opción que prefieras.`
  )
}

/**
 * Mensaje cuando el usuario elige "Realizar otra consulta" (opción 2)
 */
export function buildOtherInquiryMessage(
  escalationPhoneNumber?: string,
  clinicName: string = DEFAULT_CLINIC_NAME
): string {
  let message = `Este canal de WhatsApp es exclusivo para la gestión de turnos médicos.\n\n`
  
  if (escalationPhoneNumber) {
    message += `Para otro tipo de consultas, por favor contactanos al *${escalationPhoneNumber}*.\n\n`
  } else {
    message += `Para otro tipo de consultas, por favor comunicate con nosotros directamente.\n\n`
  }
  
  message += `Si en algún momento necesitás gestionar un turno, escribime y con gusto te ayudo.`
  
  return message
}

/**
 * Mensaje cuando el usuario elige "Solicitar un turno médico" (opción 1)
 */
export function buildTurnoIntentConfirmedMessage(): string {
  return (
    `Perfecto, te voy a ayudar con tu turno.\n\n` +
    `Para continuar, por favor *indicame tu DNI*.`
  )
}

/**
 * Saludo cuando hay MULTIPLES pacientes asociados al numero de telefono
 * Se solicita DNI para desambiguar
 */
export function buildMultiplePatientGreeting(
  patients: any[],
  clinicName: string = DEFAULT_CLINIC_NAME
): string {
  return (
    `*¡Bienvenido a ${clinicName}!*\n\n` +
    `Veo que este número está asociado a más de un paciente. ` +
    `Para poder ayudarte mejor, por favor *indicame tu DNI* (7 u 8 dígitos) ` +
    `para identificar correctamente tu información.`
  )
}

/**
 * Mensaje cuando el DNI fue validado y es paciente nuevo
 */
export function buildNewPatientDNIValidated(): string {
  return (
    `Gracias, ya hemos validado tu DNI. Te agendaremos como nuevo paciente.\n\n` +
    `¿En qué te podemos ayudar?\n\n` +
    `1- Solicitar turno médico.\n\n` +
    `Por favor seleccioná el número de opción para continuar.`
  )
}

/**
 * Mensaje de confirmacion cuando se selecciona una opcion valida
 */
export function buildSelectionConfirmation(
  selection: number,
  patientName?: string
): string {
  const firstName = patientName ? getFirstName(patientName) : ''

  const messages: Record<number, string> = {
    1: firstName
      ? `${firstName}, vamos a procesar tu confirmación de asistencia.`
      : `Vamos a procesar tu confirmación de asistencia.`,
    2: firstName
      ? `${firstName}, vamos a procesar la cancelación de tu turno.`
      : `Vamos a procesar la cancelación de tu turno.`,
    3: firstName
      ? `Perfecto ${firstName}, vamos a buscar turnos disponibles para vos.`
      : `Perfecto, vamos a buscar turnos disponibles.`,
  }

  return messages[selection] || `Procesando tu solicitud...`
}

/**
 * Mensaje cuando la seleccion es invalida
 */
export function buildInvalidSelectionMessage(): string {
  return (
    `No pude identificar tu selección. Por favor, respondé con el número de la opción que prefieras:\n\n` +
    `1- Confirmar asistencia al turno\n` +
    `2- Cancelar turno\n` +
    `3- Solicitar otro turno médico\n` +
    `4- Realizar otra consulta`
  )
}

/**
 * Mensaje cuando hay error al detectar al paciente
 */
export function buildDetectionErrorMessage(
  clinicName: string = DEFAULT_CLINIC_NAME
): string {
  return (
    `Disculpá, estamos teniendo un inconveniente técnico momentáneo. ` +
    `Por favor, indicame tu DNI para poder ayudarte.`
  )
}

/**
 * Mensaje cuando el DNI no es valido (formato incorrecto)
 */
export function buildInvalidDNIMessage(): string {
  return (
    `No pude identificar un DNI en tu mensaje. ` +
    `Por favor, enviame tu número de documento (7 u 8 dígitos).`
  )
}

/**
 * Mensaje cuando el DNI no se encuentra en los pacientes multiples
 */
export function buildDNINotFoundInMultipleMessage(attempts: number): string {
  if (attempts >= 3) {
    return (
      `No encontré el DNI ingresado asociado a este número de teléfono. ` +
      `Te voy a registrar como nuevo paciente para poder ayudarte.`
    )
  }

  return (
    `El DNI ingresado no está asociado a este número de teléfono. ` +
    `Por favor, verificá e ingresá nuevamente tu DNI (7 u 8 dígitos).`
  )
}

/**
 * Mensaje de resumen de turnos
 */
export function buildTurnosSummary(turnos: any[]): string {
  if (!turnos || turnos.length === 0) {
    return `Actualmente no tenés turnos médicos agendados.`
  }

  let mensaje = `Tus turnos agendados:\n\n`

  turnos.slice(0, 5).forEach((turno, idx) => {
    const fecha = formatearFecha(turno.Fecha || turno.fecha)
    const hora = formatearHora(turno.Hora || turno.hora || '')
    const profesional = formatearProfesional(
      turno.Profesional_Nombre || turno.profesional_nombre || turno.nombre_profesional || ''
    )
    const estado = (turno.Estado || turno.estado || '').toLowerCase()
    const estadoTexto = estado === 'confirmado' ? ' (Confirmado)' : ''

    mensaje += `${idx + 1}. ${fecha} - ${hora}\n`
    mensaje += `   ${profesional}${estadoTexto}\n\n`
  })

  if (turnos.length > 5) {
    mensaje += `... y ${turnos.length - 5} turno(s) más.`
  }

  return mensaje
}

/**
 * Mensaje de procesamiento
 */
export function buildProcessingMessage(): string {
  return `Un momento, estoy procesando tu solicitud...`
}

/**
 * Mensaje de despedida (MODO A - primera vez)
 */
export function buildFarewellMessage(
  patientName?: string,
  timeOfDay: 'morning' | 'afternoon' | 'evening' = 'afternoon'
): string {
  const firstName = patientName ? getFirstName(patientName) : ''
  
  const saludos: Record<string, string> = {
    morning: '¡Que tengas un excelente día!',
    afternoon: '¡Que disfrutes la tarde!',
    evening: '¡Que tengas buena noche!',
  }

  const saludo = saludos[timeOfDay]

  if (firstName) {
    return `Si necesitás algo más, no dudes en escribirme. ${saludo}`
  }
  return `Si necesitás algo más, no dudes en escribirme. ${saludo}`
}

/**
 * Mensaje de despedida breve (MODO B - ya se despidio antes)
 */
export function buildBriefFarewellMessage(
  patientName?: string,
  userMessageType: 'thanks' | 'ok' = 'thanks'
): string {
  const firstName = patientName ? getFirstName(patientName) : ''

  if (userMessageType === 'thanks') {
    const variants = [
      `¡A vos, ${firstName}!`,
      `¡Un gusto, ${firstName}!`,
      `¡Cualquier cosa por acá estoy!`,
    ]
    return firstName ? variants[0] : variants[2]
  }

  const variants = [
    `¡Listo, ${firstName}!`,
    `¡Perfecto, ${firstName}!`,
    `¡Buenísimo!`,
  ]
  return firstName ? variants[0] : variants[2]
}
