/**
 * Handler compartido para busqueda de profesionales
 */

import { createConversationLogger } from '../logger'
import { buscarProfesionales } from '../../api-tools/api-functions'
import { extractSelection } from '../selection-extractor'
import { detectFlowInterruption } from './flow-interruption-handler'
import type { ProfessionalOption, HandlerResult } from './types'

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
    // La API devuelve campos en PascalCase: Id, Nombre_Completo, Especialidad
    const profesionalesFormateados: ProfessionalOption[] = result.datos.map((prof: any, index: number) => ({
      numero: index + 1,
      id: prof.Id || prof.id,
      nombre: prof.Nombre_Completo || prof.nombre_completo || prof.Nombre || prof.nombre,
      especialidad: prof.Especialidad || prof.especialidad,
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
 * Opciones para el interceptor de consultas intercaladas
 */
export interface ProfessionalInterruptionOptions {
  /** Mensaje original con la lista de profesionales para re-mostrar al usuario */
  originalProfessionalsMessage: string
  /** Teléfono de la clínica para derivar consultas que el bot no puede responder */
  escalationPhone?: string
}

/**
 * Maneja la seleccion de profesional de la lista
 */
export async function handleProfessionalSelection(
  userInput: string,
  profesionalesOpciones: ProfessionalOption[],
  phoneNumber: string,
  clientId: string,
  interruptionOptions?: ProfessionalInterruptionOptions
): Promise<HandlerResult & { selectedProfessional?: ProfessionalOption }> {
  const logger = createConversationLogger(phoneNumber, clientId, 'professional_selection')

  // Usar extractSelection para detectar: numeros, palabras (uno/dos), ordinales (primero/segundo), nombre fuzzy
  const selectionOptions = profesionalesOpciones.map((p) => ({
    index: p.numero - 1, // 0-based index para extractSelection
    label: p.nombre,
  }))

  const result = extractSelection(userInput, selectionOptions)

  if (result.selected && result.selectedIndex !== undefined) {
    const profesionalSeleccionado = profesionalesOpciones[result.selectedIndex]

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

  // Sin coincidencia — verificar si es consulta intercalada (si el feature está habilitado)
  logger.info('Seleccion de profesional no reconocida', { input: userInput, matchType: result.matchType })

  if (interruptionOptions) {
    const interruption = await detectFlowInterruption(
      userInput,
      'awaiting_professional_selection',
      { originalPromptMessage: interruptionOptions.originalProfessionalsMessage },
      interruptionOptions.escalationPhone,
      phoneNumber,
      clientId
    )

    if (interruption.isInterruption && interruption.response) {
      logger.info('Consulta intercalada en seleccion de profesional, respondiendo sin cambiar fase')
      return {
        handled: true,
        message: interruption.response,
        nextPhase: 'awaiting_professional_selection',
      }
    }
  }

  return {
    handled: true,
    message: `No he encontrado la opcion que elegiste. Por favor ingresa el numero del profesional que prefieras.\n\n_Ejemplo: *1*_`,
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
