/**
 * Handler compartido para opciones de busqueda
 * 3 opciones: medico particular, especialidad, cualquier medico
 */

import { createConversationLogger } from '../logger'
import type { SearchType, HandlerResult } from './types'

/**
 * Convierte un texto a Title Case (CamelCase de palabras)
 */
function toTitleCase(text: string): string {
  if (!text) return text
  return text
    .toLowerCase()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Construye el mensaje de opciones de busqueda
 */
export function buildSearchOptionsMessage(sedeName: string): string {
  const formattedSedeName = toTitleCase(sedeName)
  return `Perfecto, elegiste *${formattedSedeName}*.

Ahora decime, como te gustaria buscar tu turno?

1. *Medico en particular* - Si ya sabes con que profesional queres atenderte
2. *Por especialidad* - Para elegir una especialidad y ver los profesionales disponibles
3. *Cualquier medico disponible* - Para ver los turnos mas proximos sin importar el profesional

Responde con el *numero* de la opcion que prefieras.`
}

/**
 * Maneja la seleccion de tipo de busqueda
 */
export async function handleSearchTypeSelection(
  userInput: string,
  phoneNumber: string,
  clientId: string
): Promise<HandlerResult & { searchType?: SearchType }> {
  const logger = createConversationLogger(phoneNumber, clientId, 'search_type_selection')

  // Normalizar input
  const inputNormalizado = userInput.trim().toLowerCase()

  // Detectar opcion por numero
  if (inputNormalizado === '1' || inputNormalizado.includes('particular') || inputNormalizado.includes('medico en particular')) {
    logger.info('Tipo de busqueda: medico_particular', {})
    return {
      handled: true,
      nextPhase: 'awaiting_professional_name',
      searchType: 'medico_particular',
    }
  }

  if (inputNormalizado === '2' || inputNormalizado.includes('especialidad')) {
    logger.info('Tipo de busqueda: especialidad', {})
    return {
      handled: true,
      nextPhase: 'awaiting_specialty_selection',
      searchType: 'especialidad',
    }
  }

  if (inputNormalizado === '3' || inputNormalizado.includes('cualquier') || inputNormalizado.includes('disponible')) {
    logger.info('Tipo de busqueda: cualquier_medico', {})
    return {
      handled: true,
      nextPhase: 'awaiting_turno_selection',
      searchType: 'cualquier_medico',
    }
  }

  // Input invalido
  logger.info('Tipo de busqueda no reconocido', { input: userInput })

  return {
    handled: true,
    message: `No reconozco esa opcion. Por favor, responde con *1*, *2* o *3*:

1. Medico en particular
2. Por especialidad
3. Cualquier medico disponible`,
    nextPhase: 'awaiting_search_type',
  }
}

/**
 * Mensaje para solicitar nombre del profesional (opcion 1)
 */
export function buildProfessionalNameRequestMessage(): string {
  return `Por favor, escribime el *nombre o apellido* del profesional con el que queres atenderte.`
}
