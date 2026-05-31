/**
 * Handler compartido para seleccion de turno
 * CRITICO: Usa campo 'numero' para mapeo, NUNCA indice de array
 */

import { createConversationLogger } from '../logger'
import type { TurnoOption, HandlerResult } from './types'

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
 * Maneja la seleccion de turno por parte del usuario
 * IMPORTANTE: Mapea por campo 'numero', NO por indice de array
 */
export async function handleTurnoSelection(
  userInput: string,
  turnosOpciones: TurnoOption[],
  phoneNumber: string,
  clientId: string
): Promise<HandlerResult & { selectedTurno?: TurnoOption }> {
  const logger = createConversationLogger(phoneNumber, clientId, 'turno_selection')

  // Normalizar input
  const inputNormalizado = userInput.trim().toLowerCase()

  // Intentar extraer numero
  const numeroMatch = inputNormalizado.match(/^\d+$/)

  if (numeroMatch) {
    const numero = parseInt(numeroMatch[0], 10)

    // CRITICO: Buscar turno por campo 'numero', NO por indice
    const turnoSeleccionado = turnosOpciones.find((t) => t.numero === numero)

    if (turnoSeleccionado) {
      logger.info('Turno seleccionado correctamente', {
        numeroInput: numero,
        turnoNumero: turnoSeleccionado.numero,
        agendaId: turnoSeleccionado.id,
        fecha: turnoSeleccionado.fecha,
        hora: turnoSeleccionado.hora,
        profesional: turnoSeleccionado.profesionalNombre,
      })

      return {
        handled: true,
        nextPhase: 'awaiting_email', // Siguiente paso: verificar/solicitar email
        selectedTurno: turnoSeleccionado,
      }
    } else {
      // Numero fuera de rango
      logger.info('Numero de turno fuera de rango', {
        numeroInput: numero,
        rangoValido: `1-${turnosOpciones.length}`,
      })

      return {
        handled: true,
        message: `Ese numero no corresponde a ninguno de los turnos mostrados. Por favor, responde con un numero del *1 al ${turnosOpciones.length}*.`,
        nextPhase: 'awaiting_turno_selection',
      }
    }
  }

  // Intentar detectar hora (HH:MM)
  const horaMatch = inputNormalizado.match(/(\d{1,2})[:\.](\d{2})/)
  if (horaMatch) {
    const hora = `${horaMatch[1].padStart(2, '0')}:${horaMatch[2]}`
    const turnoByHora = turnosOpciones.find((t) => t.hora === hora)

    if (turnoByHora) {
      logger.info('Turno seleccionado por hora', {
        horaInput: hora,
        turnoNumero: turnoByHora.numero,
        agendaId: turnoByHora.id,
      })

      return {
        handled: true,
        nextPhase: 'awaiting_email',
        selectedTurno: turnoByHora,
      }
    }
  }

  // Input no reconocido
  logger.info('Seleccion de turno no reconocida', { input: userInput })

  return {
    handled: true,
    message: `No reconozco esa opcion. Por favor, responde con el *numero* del turno que prefieras (1-${turnosOpciones.length}).`,
    nextPhase: 'awaiting_turno_selection',
  }
}

/**
 * Construye el mensaje de confirmacion previo al email
 */
export function buildTurnoSelectedMessage(turno: TurnoOption): string {
  const fechaFormateada = formatDateForDisplay(turno.fecha)

  return `Seleccionaste el turno:

*Fecha:* ${fechaFormateada.charAt(0).toUpperCase() + fechaFormateada.slice(1)}
*Hora:* ${turno.hora}
*Profesional:* ${turno.profesionalNombre}${turno.especialidad ? `\n*Especialidad:* ${turno.especialidad}` : ''}${turno.sedeNombre ? `\n*Sede:* ${turno.sedeNombre}` : ''}`
}

/**
 * Valida que el turno seleccionado coincida con la lista mostrada
 * Funcion de seguridad para evitar inconsistencias
 */
export function validateTurnoSelection(
  turnoSeleccionado: TurnoOption,
  turnosOpciones: TurnoOption[]
): boolean {
  const turnoEnLista = turnosOpciones.find((t) => t.numero === turnoSeleccionado.numero)

  if (!turnoEnLista) {
    return false
  }

  // Verificar que los datos coincidan
  return (
    turnoEnLista.id === turnoSeleccionado.id &&
    turnoEnLista.fecha === turnoSeleccionado.fecha &&
    turnoEnLista.hora === turnoSeleccionado.hora
  )
}
