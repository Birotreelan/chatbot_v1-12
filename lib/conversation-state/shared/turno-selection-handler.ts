/**
 * Handler compartido para seleccion de turno
 * CRITICO: Usa campo 'numero' para mapeo, NUNCA indice de array
 * 
 * Usa Smart Selection Handler para deteccion inteligente
 */

import { createConversationLogger } from '../logger'
import type { TurnoOption, HandlerResult } from './types'
import {
  detectSmartSelection,
  turnoToSelectionOption,
} from './smart-selection-handler'

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
 * Usa Smart Selection Handler para deteccion inteligente
 */
export async function handleTurnoSelection(
  userInput: string,
  turnosOpciones: TurnoOption[],
  phoneNumber: string,
  clientId: string
): Promise<HandlerResult & { selectedTurno?: TurnoOption }> {
  const logger = createConversationLogger(phoneNumber, clientId, 'turno_selection')

  // Convertir a SelectionOption para el smart matcher
  const selectionOptions = turnosOpciones.map(turnoToSelectionOption)

  // Usar deteccion inteligente
  const result = await detectSmartSelection(
    userInput,
    selectionOptions,
    'seleccionar el turno',
    true
  )

  logger.info('Smart selection result (turno)', {
    matched: result.matched,
    matchType: result.matchType,
    confidence: result.confidence,
    isOtherIntent: result.isOtherIntent,
  })

  // Si se detecto la opcion
  if (result.matched && result.selectedOption) {
    // CRITICO: Buscar turno por campo 'numero', NO por indice
    const turnoSeleccionado = turnosOpciones.find(t => t.numero === result.selectedOption!.numero)

    if (turnoSeleccionado) {
      logger.info('Turno seleccionado correctamente', {
        matchType: result.matchType,
        numeroInput: result.selectedOption.numero,
        turnoNumero: turnoSeleccionado.numero,
        agendaId: turnoSeleccionado.id,
        fecha: turnoSeleccionado.fecha,
        hora: turnoSeleccionado.hora,
        profesional: turnoSeleccionado.profesionalNombre,
      })

      return {
        handled: true,
        nextPhase: 'awaiting_email',
        selectedTurno: turnoSeleccionado,
      }
    }
  }

  // Si es otra intencion
  if (result.isOtherIntent && result.otherIntentResponse) {
    logger.info('Otra intencion detectada en turno', { type: result.otherIntentType })

    // Mostrar los primeros 5 turnos como recordatorio
    const turnoListRecap = turnosOpciones
      .slice(0, 5)
      .map(t => `${t.numero}. ${formatDateForDisplay(t.fecha)} ${t.hora} - ${t.profesionalNombre}`)
      .join('\n')
    
    const moreMsg = turnosOpciones.length > 5 
      ? `\n... y ${turnosOpciones.length - 5} opciones mas.` 
      : ''

    return {
      handled: true,
      message: `${result.otherIntentResponse}\n\nPara continuar, indica el *numero* del turno:\n\n${turnoListRecap}${moreMsg}`,
      nextPhase: 'awaiting_turno_selection',
    }
  }

  // FALLBACK: Intentar detectar hora directamente (HH:MM)
  const inputNormalizado = userInput.trim().toLowerCase()
  const horaMatch = inputNormalizado.match(/(\d{1,2})[:\.](\d{2})/)
  if (horaMatch) {
    const hora = `${horaMatch[1].padStart(2, '0')}:${horaMatch[2]}`
    const turnoByHora = turnosOpciones.find((t) => t.hora === hora)

    if (turnoByHora) {
      logger.info('Turno seleccionado por hora directa', {
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

  // No se pudo detectar
  const errorMsg = result.errorMessage ||
    `No reconozco esa opcion. Por favor, responde con el *numero* del turno que prefieras (1-${turnosOpciones.length}).`

  logger.info('Seleccion de turno no reconocida', { input: userInput })

  return {
    handled: true,
    message: errorMsg,
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
