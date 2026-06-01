/**
 * Handler compartido para busqueda de profesionales
 * 
 * Usa Smart Selection Handler para deteccion inteligente
 */

import { createConversationLogger } from '../logger'
import { buscarProfesionales } from '../../api-tools/api-functions'
import type { ProfessionalOption, HandlerResult } from './types'
import {
  detectSmartSelection,
  professionalToSelectionOption,
} from './smart-selection-handler'

/**
 * Busca profesionales por nombre
 */
export async function searchProfessionals(
  clientId: string,
  searchTerm: string
): Promise<{
  success: boolean
  profesionales?: ProfessionalOption[]
  error?: string
}> {
  try {
    const result = await buscarProfesionales(clientId, searchTerm)

    if (!result.exito || !result.datos || result.datos.length === 0) {
      return {
        success: false,
        error: `No se encontraron profesionales con el nombre "${searchTerm}"`,
      }
    }

    // Mapear profesionales al formato estandar con numeracion
    const profesionalesFormateados: ProfessionalOption[] = result.datos.map((prof, index) => ({
      numero: index + 1,
      id: prof.id,
      nombre: prof.nombre,
      especialidad: prof.especialidad,
    }))

    return {
      success: true,
      profesionales: profesionalesFormateados,
    }
  } catch (error) {
    console.error('[professional-handler] Error searching professionals:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error desconocido',
    }
  }
}

/**
 * Construye mensaje con lista de profesionales encontrados
 */
export function buildProfessionalsListMessage(
  profesionales: ProfessionalOption[],
  searchTerm: string
): string {
  if (profesionales.length === 1) {
    const prof = profesionales[0]
    return `Encontre a *${prof.nombre}*${prof.especialidad ? ` (${prof.especialidad})` : ''}.

Voy a buscar los turnos disponibles con este profesional.`
  }

  let message = `Encontre ${profesionales.length} profesionales que coinciden con "${searchTerm}":\n\n`

  profesionales.forEach((prof) => {
    message += `${prof.numero}. *${prof.nombre}*`
    if (prof.especialidad) {
      message += ` - ${prof.especialidad}`
    }
    message += '\n'
  })

  message += `\nResponde con el *numero* del profesional con quien queres atenderte.`
  return message
}

/**
 * Maneja la seleccion de profesional de la lista
 * Usa Smart Selection Handler para deteccion inteligente
 */
export async function handleProfessionalSelection(
  userInput: string,
  profesionalesOpciones: ProfessionalOption[],
  phoneNumber: string,
  clientId: string
): Promise<HandlerResult & { selectedProfessional?: ProfessionalOption }> {
  const logger = createConversationLogger(phoneNumber, clientId, 'professional_selection')

  // Convertir a SelectionOption para el smart matcher
  const selectionOptions = profesionalesOpciones.map(professionalToSelectionOption)

  // Usar deteccion inteligente
  const result = await detectSmartSelection(
    userInput,
    selectionOptions,
    'seleccionar el profesional',
    true
  )

  logger.info('Smart selection result (profesional)', {
    matched: result.matched,
    matchType: result.matchType,
    confidence: result.confidence,
    isOtherIntent: result.isOtherIntent,
  })

  // Si se detecto la opcion
  if (result.matched && result.selectedOption) {
    const profesionalSeleccionado = profesionalesOpciones.find(p => p.id === result.selectedOption!.id)

    if (profesionalSeleccionado) {
      logger.info('Profesional seleccionado', {
        matchType: result.matchType,
        profesionalId: profesionalSeleccionado.id,
        profesionalNombre: profesionalSeleccionado.nombre,
      })

      return {
        handled: true,
        nextPhase: 'awaiting_turno_selection',
        selectedProfessional: profesionalSeleccionado,
      }
    }
  }

  // Si es otra intencion
  if (result.isOtherIntent && result.otherIntentResponse) {
    logger.info('Otra intencion detectada en profesional', { type: result.otherIntentType })

    const profesionalListRecap = profesionalesOpciones
      .map(p => `${p.numero}. ${p.nombre}${p.especialidad ? ` - ${p.especialidad}` : ''}`)
      .join('\n')

    return {
      handled: true,
      message: `${result.otherIntentResponse}\n\nPara continuar, indica el *numero* del profesional:\n\n${profesionalListRecap}`,
      nextPhase: 'awaiting_professional_selection',
    }
  }

  // No se pudo detectar
  const errorMsg = result.errorMessage ||
    `No reconozco esa opcion. Por favor, responde con el *numero* del profesional (1-${profesionalesOpciones.length}).`

  logger.info('Seleccion de profesional no detectada', { input: userInput })

  return {
    handled: true,
    message: errorMsg,
    nextPhase: 'awaiting_professional_selection',
  }
}

/**
 * Maneja la entrada de nombre de profesional (busqueda inicial)
 */
export async function handleProfessionalNameInput(
  userInput: string,
  clientId: string,
  phoneNumber: string
): Promise<HandlerResult & { profesionales?: ProfessionalOption[] }> {
  const logger = createConversationLogger(phoneNumber, clientId, 'professional_name_input')

  const searchTerm = userInput.trim()

  if (searchTerm.length < 2) {
    return {
      handled: true,
      message: 'Por favor, escribi al menos 2 caracteres del nombre o apellido del profesional.',
      nextPhase: 'awaiting_professional_name',
    }
  }

  logger.info('Buscando profesional', { searchTerm })

  const result = await searchProfessionals(clientId, searchTerm)

  if (!result.success || !result.profesionales) {
    return {
      handled: true,
      message: `No encontre profesionales con el nombre "${searchTerm}". Por favor, verifica el nombre e intenta nuevamente, o responde *2* para buscar por especialidad.`,
      nextPhase: 'awaiting_professional_name',
    }
  }

  // Si hay un solo profesional, seleccionarlo automaticamente
  if (result.profesionales.length === 1) {
    const profesional = result.profesionales[0]
    logger.info('Profesional unico encontrado, seleccion automatica', {
      profesionalId: profesional.id,
      profesionalNombre: profesional.nombre,
    })

    return {
      handled: true,
      message: buildProfessionalsListMessage(result.profesionales, searchTerm),
      nextPhase: 'awaiting_turno_selection',
      profesionales: result.profesionales,
    }
  }

  // Si hay multiples profesionales, mostrar lista
  return {
    handled: true,
    message: buildProfessionalsListMessage(result.profesionales, searchTerm),
    nextPhase: 'awaiting_professional_selection',
    profesionales: result.profesionales,
  }
}

/**
 * Mensaje cuando no se encuentran profesionales
 */
export function buildNoProfessionalsFoundMessage(searchTerm: string): string {
  return `No encontre profesionales con el nombre "${searchTerm}".

Por favor:
- Verifica el nombre e intenta nuevamente
- O responde *2* para buscar por especialidad
- O responde *3* para ver cualquier medico disponible`
}
