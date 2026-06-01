/**
 * Handler compartido para confirmacion y reserva de turno
 */

import { createConversationLogger } from '../logger'
import { reservarTurno } from '../../api-tools/api-functions'
import type { TurnoOption, HandlerResult, SharedFlowState } from './types'

/**
 * Formatea fecha para mostrar al usuario (formato argentino)
 */
function formatDateForDisplay(dateStr: string): string {
  const [year, month, day] = dateStr.split('-')
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
  const diasSemana = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

  return `${diasSemana[date.getDay()]} ${parseInt(day)} de ${meses[date.getMonth()]}`
}

/**
 * Construye mensaje de confirmacion final
 */
export function buildConfirmationMessage(
  turno: TurnoOption,
  patientName: string,
  sedeName?: string,
  obraSocialNombre?: string,
  patientData?: {
    apellido?: string
    nombre?: string
    dni?: string
    telefono?: string
    email?: string
  }
): string {
  const fechaFormateada = formatDateForDisplay(turno.fecha)
  const primerNombre = patientName.split(' ')[0]

  let message = `${primerNombre}, para confirmar tu reserva necesito verificar los datos:\n\n`

  message += `**DATOS DEL PACIENTE:**\n\n`
  
  if (patientData?.apellido) {
    message += `Apellido: ${patientData.apellido}\n\n`
  }
  
  if (patientData?.nombre) {
    message += `Nombre: ${patientData.nombre}\n\n`
  }
  
  if (patientData?.dni) {
    message += `DNI: ${patientData.dni}\n\n`
  }
  
  if (patientData?.telefono) {
    message += `Celular: ${patientData.telefono}\n\n`
  }
  
  if (patientData?.email) {
    message += `Mail: ${patientData.email}\n\n`
  }
  
  if (obraSocialNombre) {
    message += `Obra Social: ${obraSocialNombre}\n\n`
  }

  message += `**DATOS DEL TURNO:**\n\n`
  message += `Fecha: ${fechaFormateada.charAt(0).toUpperCase() + fechaFormateada.slice(1)}\n\n`
  message += `Hora: ${turno.hora}\n\n`
  message += `Profesional: Dr. ${turno.profesionalNombre}\n\n`

  if (sedeName || turno.sedeNombre) {
    message += `Sede: ${sedeName || turno.sedeNombre}\n\n`
  }

  message += `Id Turno: ${turno.id}\n\n`

  message += `¿Confirmás que los datos son correctos y deseás realizar la reserva del turno número ${turno.numero}?\n\n`
  message += `Respondé con:\n`
  message += `1. Sí, confirmar\n`
  message += `2. No, modificar`

  return message
}

/**
 * Maneja la respuesta de confirmacion
 */
export async function handleConfirmationResponse(
  userInput: string,
  phoneNumber: string,
  clientId: string
): Promise<HandlerResult & { confirmed?: boolean }> {
  const logger = createConversationLogger(phoneNumber, clientId, 'confirmation_response')

  const inputNormalizado = userInput.trim().toLowerCase()

  // Detectar confirmacion positiva
  const confirmacionPositiva = ['si', 'sí', 'yes', 'confirmo', 'confirmar', 'ok', 'dale', 'bueno', 'perfecto', '1']
  const confirmacionNegativa = ['no', 'cancelar', 'cancelo', 'no quiero', 'modificar', '2']

  if (confirmacionPositiva.some((c) => inputNormalizado.includes(c))) {
    logger.info('Confirmacion positiva recibida', {})
    return {
      handled: true,
      confirmed: true,
    }
  }

  if (confirmacionNegativa.some((c) => inputNormalizado.includes(c))) {
    logger.info('Confirmacion negativa recibida', {})
    return {
      handled: true,
      confirmed: false,
      message: 'Entendido. Volvamos al inicio para que puedas elegir otro turno o cambiar tus datos.',
      nextPhase: 'abandoned',
    }
  }

  // Input no claro
  logger.info('Respuesta de confirmacion no clara', { input: userInput })

  return {
    handled: true,
    message: 'No entendi tu respuesta. Por favor, respondé con:\n1. Sí, confirmar\n2. No, modificar',
    nextPhase: 'awaiting_confirmation',
  }
}
  }

  if (confirmacionNegativa.some((c) => inputNormalizado.includes(c))) {
    logger.info('Confirmacion negativa recibida', {})
    return {
      handled: true,
      confirmed: false,
      message: 'Entendido, la reserva ha sido cancelada. Si necesitas agendar un turno en otro momento, estoy para ayudarte.',
      nextPhase: 'abandoned',
    }
  }

  // Input no claro
  logger.info('Respuesta de confirmacion no clara', { input: userInput })

  return {
    handled: true,
    message: 'No entendi tu respuesta. Por favor, responde *SI* para confirmar el turno o *NO* para cancelar.',
    nextPhase: 'awaiting_confirmation',
  }
}

/**
 * Ejecuta la reserva del turno
 */
export async function executeReservation(
  clientId: string,
  turno: TurnoOption,
  patientData: {
    nombre?: string
    apellido?: string
    dni?: string
    telefono: string
    email: string
    obraSocialId?: string
    obraSocialNombre?: string
  },
  phoneNumber: string
): Promise<{
  success: boolean
  message: string
  error?: string
}> {
  const logger = createConversationLogger(phoneNumber, clientId, 'reservation')

  logger.info('Ejecutando reserva de turno', {
    agendaId: turno.id,
    fecha: turno.fecha,
    hora: turno.hora,
    profesional: turno.profesionalNombre,
  })

  try {
    const result = await reservarTurno(clientId, turno.id, {
      nombre: patientData.nombre,
      apellido: patientData.apellido,
      dni: patientData.dni,
      telefono: patientData.telefono,
      email: patientData.email,
      deudorId: patientData.obraSocialId,
      deudorNombre: patientData.obraSocialNombre,
    })

    if (result.exito) {
      logger.info('Reserva exitosa', { agendaId: turno.id })

      const fechaFormateada = formatDateForDisplay(turno.fecha)

      return {
        success: true,
        message: `¡Listo! Tu turno ha sido reservado exitosamente.

*Detalles de tu turno:*
*Fecha:* ${fechaFormateada.charAt(0).toUpperCase() + fechaFormateada.slice(1)}
*Hora:* ${turno.hora}
*Profesional:* ${turno.profesionalNombre}

Te enviamos un email de confirmacion a *${patientData.email}*.

Recorda llegar 15 minutos antes de tu turno. ¡Te esperamos!`,
      }
    } else {
      logger.error('Error en reserva', { error: result.error })

      return {
        success: false,
        message: 'No se pudo completar la reserva en este momento. Por favor, intenta nuevamente o comunicate directamente con la clinica.',
        error: result.error?.mensaje || 'Error desconocido',
      }
    }
  } catch (error) {
    logger.error('Excepcion en reserva', { error: error instanceof Error ? error.message : 'Unknown' })

    return {
      success: false,
      message: 'Ocurrio un error al procesar tu reserva. Por favor, intenta nuevamente en unos minutos.',
      error: error instanceof Error ? error.message : 'Error desconocido',
    }
  }
}

/**
 * Mensaje de reserva cancelada
 */
export function buildCancellationMessage(): string {
  return 'La reserva ha sido cancelada. Si necesitas agendar un turno en otro momento, estoy para ayudarte.'
}
