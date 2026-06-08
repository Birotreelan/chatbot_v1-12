/**
 * Handler compartido para especialidades
 */

import { createConversationLogger } from '../logger'
import { obtenerSubespecialidades } from '../../api-tools/api-functions'
import { extractSelection } from '../selection-extractor'
import type { SpecialtyOption, HandlerResult } from './types'

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

    if (!result.exito || !result.datos || !Array.isArray(result.datos) || result.datos.length === 0) {
      return {
        success: false,
        error: result.error?.mensaje || 'No se encontraron especialidades disponibles',
      }
    }

    // obtenerSubespecialidades ya normaliza el array — mapear campos PascalCase de la API
    const especialidadesFormateadas: SpecialtyOption[] = result.datos.map((esp: any, index: number) => ({
      numero: index + 1,
      id: esp.Id || esp.id,
      nombre: esp.Nombre || esp.nombre,
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
 */
export async function handleSpecialtySelection(
  userInput: string,
  especialidadesOpciones: SpecialtyOption[],
  phoneNumber: string,
  clientId: string
): Promise<HandlerResult & { selectedSpecialty?: SpecialtyOption }> {
  const logger = createConversationLogger(phoneNumber, clientId, 'specialty_selection')

  // Usar extractSelection para detectar: numeros, palabras (uno/dos), ordinales (primero/segundo), nombre fuzzy
  const selectionOptions = especialidadesOpciones.map((e) => ({
    index: e.numero - 1, // 0-based index para extractSelection
    label: e.nombre,
  }))

  const result = extractSelection(userInput, selectionOptions)

  if (result.selected && result.selectedIndex !== undefined) {
    const especialidadSeleccionada = especialidadesOpciones[result.selectedIndex]

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

  // Sin coincidencia
  logger.info('Seleccion de especialidad no reconocida', { input: userInput, matchType: result.matchType })

  return {
    handled: true,
    message: `No he encontrado la opcion que elegiste. Por favor ingresa el numero de la especialidad que necesitas.\n\n_Ejemplo: *2*_`,
    nextPhase: 'awaiting_specialty_selection',
  }
}

/**
 * Mensaje de error cuando no se pueden obtener especialidades
 */
export function buildSpecialtiesErrorMessage(): string {
  return 'No pude obtener las especialidades disponibles en este momento. Por favor, intenta nuevamente en unos minutos.'
}
