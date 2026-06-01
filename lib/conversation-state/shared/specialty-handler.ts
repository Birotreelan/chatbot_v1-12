/**
 * Handler compartido para especialidades
 * 
 * Usa Smart Selection Handler para deteccion inteligente
 */

import { createConversationLogger } from '../logger'
import { obtenerSubespecialidades } from '../../api-tools/api-functions'
import type { SpecialtyOption, HandlerResult } from './types'
import {
  detectSmartSelection,
  specialtyToSelectionOption,
} from './smart-selection-handler'

/**
 * Obtiene las especialidades desde la API
 */
export async function fetchSpecialties(clientId: string): Promise<{
  success: boolean
  especialidades?: SpecialtyOption[]
  error?: string
}> {
  try {
    const result = await obtenerSubespecialidades(clientId)

    if (!result.exito || !result.datos || result.datos.length === 0) {
      return {
        success: false,
        error: result.error?.mensaje || 'No se encontraron especialidades disponibles',
      }
    }

    // Mapear especialidades al formato estandar con numeracion
    const especialidadesFormateadas: SpecialtyOption[] = result.datos.map((esp, index) => ({
      numero: index + 1,
      id: esp.id,
      nombre: esp.nombre,
    }))

    return {
      success: true,
      especialidades: especialidadesFormateadas,
    }
  } catch (error) {
    console.error('[specialty-handler] Error fetching specialties:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error desconocido',
    }
  }
}

/**
 * Construye el mensaje de seleccion de especialidades
 */
export function buildSpecialtiesMessage(especialidades: SpecialtyOption[]): string {
  let message = `Estas son las especialidades disponibles:\n\n`

  especialidades.forEach((esp) => {
    message += `${esp.numero}. ${esp.nombre}\n`
  })

  message += `\nResponde con el *numero* de la especialidad que necesitas.`
  return message
}

/**
 * Maneja la seleccion de especialidad
 * Usa Smart Selection Handler para deteccion inteligente
 */
export async function handleSpecialtySelection(
  userInput: string,
  especialidadesOpciones: SpecialtyOption[],
  phoneNumber: string,
  clientId: string
): Promise<HandlerResult & { selectedSpecialty?: SpecialtyOption }> {
  const logger = createConversationLogger(phoneNumber, clientId, 'specialty_selection')

  // Convertir a SelectionOption para el smart matcher
  const selectionOptions = especialidadesOpciones.map(specialtyToSelectionOption)

  // Usar deteccion inteligente
  const result = await detectSmartSelection(
    userInput,
    selectionOptions,
    'seleccionar la especialidad medica',
    true
  )

  logger.info('Smart selection result (especialidad)', {
    matched: result.matched,
    matchType: result.matchType,
    confidence: result.confidence,
    isOtherIntent: result.isOtherIntent,
  })

  // Si se detecto la opcion
  if (result.matched && result.selectedOption) {
    const especialidadSeleccionada = especialidadesOpciones.find(e => e.id === result.selectedOption!.id)

    if (especialidadSeleccionada) {
      logger.info('Especialidad seleccionada', {
        matchType: result.matchType,
        especialidadId: especialidadSeleccionada.id,
        especialidadNombre: especialidadSeleccionada.nombre,
      })

      return {
        handled: true,
        nextPhase: 'awaiting_turno_selection',
        selectedSpecialty: especialidadSeleccionada,
      }
    }
  }

  // Si es otra intencion
  if (result.isOtherIntent && result.otherIntentResponse) {
    logger.info('Otra intencion detectada en especialidad', { type: result.otherIntentType })

    const especialidadListRecap = especialidadesOpciones
      .map(e => `${e.numero}. ${e.nombre}`)
      .join('\n')

    return {
      handled: true,
      message: `${result.otherIntentResponse}\n\nPara continuar, indica el *numero* de la especialidad:\n\n${especialidadListRecap}`,
      nextPhase: 'awaiting_specialty_selection',
    }
  }

  // No se pudo detectar
  const errorMsg = result.errorMessage ||
    `No reconozco esa especialidad. Por favor, responde con el *numero* de la especialidad (1-${especialidadesOpciones.length}).`

  logger.info('Seleccion de especialidad no detectada', { input: userInput })

  return {
    handled: true,
    message: errorMsg,
    nextPhase: 'awaiting_specialty_selection',
  }
}

/**
 * Mensaje de error cuando no se pueden obtener especialidades
 */
export function buildSpecialtiesErrorMessage(): string {
  return 'No pude obtener las especialidades disponibles en este momento. Por favor, intenta nuevamente en unos minutos.'
}
