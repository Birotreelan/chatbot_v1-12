import { ExistingPatientFlowState } from './existing-patient-flow-handler'
import { formatName, getFirstName } from '@/lib/utils/name-utils'

/**
 * Mensajes para el flujo de paciente existente
 */

export function buildWelcomeMessage(patientName: string): string {
  return `Hola ${getFirstName(patientName)}, te ayudaré a agendar un nuevo turno. ¿Por dónde comenzamos?`
}

export function buildEmailRequestMessage(): string {
  return `Para continuar, necesito tu email para la confirmación del turno.\n\nPor favor, escribe tu email:`
}

export function buildInvalidEmailMessage(attempt: number): string {
  if (attempt === 1) {
    return `Email inválido. Por favor, ingresa un email válido (ej: nombre@email.com):`
  }
  return `El email sigue siendo inválido. Intenta nuevamente (ej: tu.email@dominio.com):`
}

export function buildSedeSelectionMessage(sedes: any[]): string {
  let message = `Para continuar, necesito que selecciones la sede donde queres atenderte:\n\n`

  sedes.forEach((sede, index) => {
    // Usar nombre completo y agregar direccion si esta disponible
    const nombre = formatName(sede.nombre || sede.Nombre_Completo || 'Sede sin nombre')
    const domicilio = sede.domicilio || sede.Domicilio || ''
    const localidad = sede.localidad || sede.Localidad || ''
    const provincia = sede.provincia || sede.Provincia || ''
    
    let sedeInfo = `${index + 1}. ${nombre}`
    
    // Agregar ubicacion si esta disponible
    const ubicacionParts = [domicilio, localidad, provincia]
      .filter(Boolean)
      .map(formatName)
    if (ubicacionParts.length > 0) {
      sedeInfo += `, ubicada en ${ubicacionParts.join(', ')}`
    }
    
    message += `${sedeInfo}\n`
  })

  message += `\nResponde con el numero de tu opcion:`
  return message
}

export function buildSearchTypeMessage(): string {
  return `¿Cómo prefieres buscar tu turno?\n\n1. Por médico específico\n2. Por especialidad\n3. Con cualquier médico disponible\n\nResponde 1, 2 o 3:`
}

export function buildProfessionalSearchMessage(): string {
  return `¿Cuál es el nombre del médico? Escríbelo (ej: Dr. Pérez):`
}

export function buildSpecialtySelectionMessage(especialidades: any[]): string {
  let message = `Selecciona la especialidad:\n\n`

  especialidades.forEach((esp, index) => {
    message += `${index + 1}. ${esp.nombre}\n`
  })

  message += `\nResponde con el número:`
  return message
}

export function buildTurnosListMessage(turnos: any[]): string {
  let message = `Turnos disponibles:\n\n`

  turnos.forEach((turno, index) => {
    const fecha = turno.fecha || turno.Fecha || 'Fecha no disponible'
    const hora = turno.hora || turno.Hora || '00:00'
    const doctor = turno.doctor || turno.Doctor || turno.Profesional || 'Profesional'

    message += `${index + 1}. ${fecha} a las ${hora} - ${doctor}\n`
  })

  message += `\nSelecciona el turno con su número:`
  return message
}

export function buildConfirmationMessage(turno: any, patientName: string): string {
  const fecha = turno.fecha || turno.Fecha || 'Fecha'
  const hora = turno.hora || turno.Hora || 'Hora'
  const doctor = turno.doctor || turno.Doctor || turno.Profesional || 'Profesional'

  return `Resumen de tu turno:\n\n` +
    `Paciente: ${patientName}\n` +
    `Fecha: ${fecha}\n` +
    `Hora: ${hora}\n` +
    `Médico: ${doctor}\n\n` +
    `¿Confirmas este turno?\n\n1. Sí, confirmar\n2. No, volver atrás`
}

export function buildSuccessMessage(turno: any): string {
  const fecha = turno.fecha || turno.Fecha || 'Fecha'
  const hora = turno.hora || turno.Hora || 'Hora'

  return `¡Tu turno ha sido reservado exitosamente!\n\n` +
    `Fecha: ${fecha}\n` +
    `Hora: ${hora}\n\n` +
    `Recibirás una confirmación por email. ¿Hay algo más en lo que pueda ayudarte?`
}

export function buildErrorMessage(error: string): string {
  return `Disculpa, ocurrió un error: ${error}\n\n¿Quieres intentar nuevamente?`
}

export function buildInvalidSelectionMessage(maxOptions: number): string {
  return `Selección inválida. Por favor, elige un número entre 1 y ${maxOptions}:`
}

export function buildNoTurnosMessage(): string {
  return `Lo siento, no hay turnos disponibles con los criterios seleccionados.\n\n` +
    `¿Quieres intentar con otros parámetros?`
}

export function buildTooManyAttemptsMessage(): string {
  return `Parece que hay dificultad para procesar tu solicitud.\n\n` +
    `Un asesor te contactará en breve para ayudarte.`
}
