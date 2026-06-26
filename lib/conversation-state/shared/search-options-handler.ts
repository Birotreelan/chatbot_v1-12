/**
 * Handler compartido para opciones de busqueda
 * 3 opciones: medico particular, especialidad, cualquier medico
 */

import { createConversationLogger } from '../logger'
import type { SearchType, HandlerResult } from './types'
import { parseOptionNumber } from '../selection-extractor'

export interface SearchOptionsConfig {
  enableSearchByProfessional?: boolean
  enableSearchBySpecialty?: boolean
  enableSearchByAnyDoctor?: boolean
}

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
 * Construye las opciones disponibles basado en la configuración
 */
function getAvailableOptions(config?: SearchOptionsConfig): Array<{ number: number; key: string; label: string; description: string }> {
  // Default: todas las opciones habilitadas
  const enableByProfessional = config?.enableSearchByProfessional !== false
  const enableBySpecialty = config?.enableSearchBySpecialty !== false
  const enableByAnyDoctor = config?.enableSearchByAnyDoctor !== false

  const allOptions = [
    {
      number: 1,
      key: 'medico_particular',
      label: 'Medico en particular',
      description: 'Si ya sabes con que profesional queres atenderte',
    },
    {
      number: 2,
      key: 'especialidad',
      label: 'Por especialidad',
      description: 'Para elegir una especialidad y ver los profesionales disponibles',
    },
    {
      number: 3,
      key: 'cualquier_medico',
      label: 'Cualquier medico disponible',
      description: 'Para ver los turnos mas proximos sin importar el profesional',
    },
  ]

  // Filtrar según configuración
  let availableOptions = allOptions.filter((opt) => {
    if (opt.number === 1) return enableByProfessional
    if (opt.number === 2) return enableBySpecialty
    if (opt.number === 3) return enableByAnyDoctor
    return true
  })

  // Renumerar opciones (1, 2, 3, etc.)
  availableOptions = availableOptions.map((opt, index) => ({
    ...opt,
    number: index + 1,
  }))

  return availableOptions
}

/**
 * Construye el mensaje de opciones de busqueda
 */
export function buildSearchOptionsMessage(sedeName: string, config?: SearchOptionsConfig): string {
  const formattedSedeName = toTitleCase(sedeName)
  const availableOptions = getAvailableOptions(config)

  const optionsText = availableOptions
    .map((opt) => `${opt.number}. *${opt.label}* - ${opt.description}`)
    .join('\n')

  return `Perfecto, elegiste *${formattedSedeName}*.

Ahora decime, como te gustaria buscar tu turno?

${optionsText}

Responde con el *numero* de la opcion que prefieras.`
}

/**
 * Maneja la seleccion de tipo de busqueda
 */
export async function handleSearchTypeSelection(
  userInput: string,
  phoneNumber: string,
  clientId: string,
  config?: SearchOptionsConfig
): Promise<HandlerResult & { searchType?: SearchType }> {
  const logger = createConversationLogger(phoneNumber, clientId, 'search_type_selection')
  const availableOptions = getAvailableOptions(config)

  // Normalizar input
  const inputNormalizado = userInput.trim().toLowerCase()

  // Extraer número canónico: maneja "1", "opcion 1", "OPCION1", "Opción 2", etc.
  const rawNumber = /^[0-9]+$/.test(inputNormalizado)
    ? parseInt(inputNormalizado, 10)
    : parseOptionNumber(userInput)

  // Opcion "Buscar en otra sede": es la opcion N+1 (despues de las busquedas disponibles).
  // Solo se ofrece en el mensaje de "no hay turnos" (buildNoTurnosMessage), pero la
  // detectamos aqui para reusar el mismo handler de seleccion de tipo de busqueda.
  const cambiarSedeNumber = availableOptions.length + 1
  if (rawNumber === cambiarSedeNumber) {
    logger.info('Tipo de busqueda: cambiar_sede', {})
    return {
      handled: true,
      nextPhase: 'awaiting_sede',
      searchType: 'cambiar_sede',
    }
  }

  // Detectar opcion por numero (incluye frases "opcion N")
  const optionByNumber = rawNumber !== null
    ? availableOptions.find((opt) => opt.number === rawNumber)
    : undefined
  if (optionByNumber) {
    logger.info(`Tipo de busqueda: ${optionByNumber.key}`, {})
    
    const nextPhases: Record<string, string> = {
      'medico_particular': 'awaiting_professional_name',
      'especialidad': 'awaiting_specialty_selection',
      'cualquier_medico': 'awaiting_turno_selection',
    }

    return {
      handled: true,
      nextPhase: nextPhases[optionByNumber.key] || 'awaiting_turno_selection',
      searchType: optionByNumber.key as SearchType,
    }
  }

  // Detectar por keywords
  if (inputNormalizado.includes('particular') || inputNormalizado.includes('medico en particular')) {
    logger.info('Tipo de busqueda: medico_particular', {})
    return {
      handled: true,
      nextPhase: 'awaiting_professional_name',
      searchType: 'medico_particular',
    }
  }

  if (inputNormalizado.includes('especialidad')) {
    logger.info('Tipo de busqueda: especialidad', {})
    return {
      handled: true,
      nextPhase: 'awaiting_specialty_selection',
      searchType: 'especialidad',
    }
  }

  if (inputNormalizado.includes('cualquier') || inputNormalizado.includes('disponible')) {
    logger.info('Tipo de busqueda: cualquier_medico', {})
    return {
      handled: true,
      nextPhase: 'awaiting_turno_selection',
      searchType: 'cualquier_medico',
    }
  }

  if (inputNormalizado.includes('otra sede') || inputNormalizado.includes('cambiar sede') || inputNormalizado.includes('otra clinica')) {
    logger.info('Tipo de busqueda: cambiar_sede', {})
    return {
      handled: true,
      nextPhase: 'awaiting_sede',
      searchType: 'cambiar_sede',
    }
  }

  // Input invalido - mostrar opciones disponibles
  logger.info('Tipo de busqueda no reconocido', { input: userInput })

  const optionsText = availableOptions
    .map((opt) => `${opt.number}. ${opt.label}`)
    .join('\n')

  return {
    handled: true,
    message: `No reconozco esa opcion. Por favor, responde con el numero de la opcion:

${optionsText}`,
    nextPhase: 'awaiting_search_type',
  }
}

/**
 * Mensaje para solicitar nombre del profesional (opcion 1)
 */
export function buildProfessionalNameRequestMessage(): string {
  return `Por favor, escribime el *nombre o apellido* del profesional con el que queres atenderte.`
}
