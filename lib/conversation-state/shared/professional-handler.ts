/**
 * Handler compartido para busqueda de profesionales
 */

import { createConversationLogger } from '../logger'
import { buscarProfesionales } from '../../api-tools/api-functions'
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
 */
export async function handleProfessionalSelection(
  userInput: string,
  profesionalesOpciones: ProfessionalOption[],
  phoneNumber: string,
  clientId: string
): Promise<HandlerResult & { selectedProfessional?: ProfessionalOption }> {
  const logger = createConversationLogger(phoneNumber, clientId, 'professional_selection')

  // Normalizar input
  const inputNormalizado = userInput.trim().toLowerCase()

  // Intentar extraer numero
  const numeroMatch = inputNormalizado.match(/^\d+$/)

  if (numeroMatch) {
    const numero = parseInt(numeroMatch[0], 10)

    // Buscar profesional por numero (NO por indice)
    const profesionalSeleccionado = profesionalesOpciones.find((p) => p.numero === numero)

    if (profesionalSeleccionado) {
      logger.info('Profesional seleccionado por numero', {
        numero,
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

  // 2. Detectar numeros escritos en palabras
  const numerosPalabras: Record<string, number> = {
    'primer': 1, 'primera': 1, 'primero': 1, 'uno': 1, 'un': 1,
    'segundo': 2, 'segunda': 2, 'dos': 2,
    'tercer': 3, 'tercera': 3, 'tercero': 3, 'tres': 3,
    'cuarto': 4, 'cuarta': 4, 'cuatro': 4,
    'quinto': 5, 'quinta': 5, 'cinco': 5,
    'sexto': 6, 'sexta': 6, 'seis': 6,
    'septimo': 7, 'septima': 7, 'séptimo': 7, 'séptima': 7, 'siete': 7,
    'octavo': 8, 'octava': 8, 'ocho': 8,
    'noveno': 9, 'novena': 9, 'nueve': 9,
    'decimo': 10, 'decima': 10, 'décimo': 10, 'décima': 10, 'diez': 10,
  }

  for (const [palabra, numero] of Object.entries(numerosPalabras)) {
    if (inputNormalizado.includes(palabra)) {
      const profesionalSeleccionado = profesionalesOpciones.find((p) => p.numero === numero)
      if (profesionalSeleccionado) {
        logger.info('Profesional seleccionado por numero en palabras', { palabra, numero })
        return {
          handled: true,
          nextPhase: 'awaiting_turno_selection',
          selectedProfessional: profesionalSeleccionado,
        }
      }
    }
  }

  // 3. Intentar match por nombre exacto
  const profesionalByName = profesionalesOpciones.find((p) =>
    p.nombre.toLowerCase().includes(inputNormalizado) ||
    inputNormalizado.includes(p.nombre.toLowerCase())
  )

  if (profesionalByName) {
    logger.info('Profesional seleccionado por nombre', {
      profesionalId: profesionalByName.id,
      profesionalNombre: profesionalByName.nombre,
    })

    return {
      handled: true,
      nextPhase: 'awaiting_turno_selection',
      selectedProfessional: profesionalByName,
    }
  }

  // 4. FALLBACK: Si es texto no reconocido, pedir numero
  const esTexto = /[a-zA-ZáéíóúÁÉÍÓÚñÑ]/.test(inputNormalizado)

  if (esTexto) {
    logger.info('Seleccion de profesional por texto no reconocido - sugiriendo numero', { input: userInput })
    return {
      handled: true,
      message: `No encontre ese profesional en la lista. Por favor, indica el *numero* de la opcion que preferis (1-${profesionalesOpciones.length}).`,
      nextPhase: 'awaiting_professional_selection',
    }
  }

  // 5. Numero invalido
  logger.info('Seleccion de profesional invalida', { input: userInput })

  return {
    handled: true,
    message: `No reconozco esa opcion. Por favor, responde con el *numero* del profesional (1-${profesionalesOpciones.length}).`,
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
