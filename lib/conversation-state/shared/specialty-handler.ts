/**
 * Handler compartido para especialidades
 */

import { createConversationLogger } from '../logger'
import { obtenerSubespecialidades } from '../../api-tools/api-functions'
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
 */
export async function handleSpecialtySelection(
  userInput: string,
  especialidadesOpciones: SpecialtyOption[],
  phoneNumber: string,
  clientId: string
): Promise<HandlerResult & { selectedSpecialty?: SpecialtyOption }> {
  const logger = createConversationLogger(phoneNumber, clientId, 'specialty_selection')

  // Normalizar input
  const inputNormalizado = userInput.trim().toLowerCase()

  // Intentar extraer numero
  const numeroMatch = inputNormalizado.match(/^\d+$/)

  if (numeroMatch) {
    const numero = parseInt(numeroMatch[0], 10)

    // Buscar especialidad por numero (NO por indice)
    const especialidadSeleccionada = especialidadesOpciones.find((e) => e.numero === numero)

    if (especialidadSeleccionada) {
      logger.info('Especialidad seleccionada por numero', {
        numero,
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

  // Intentar match por nombre
  const especialidadByName = especialidadesOpciones.find((e) =>
    e.nombre.toLowerCase().includes(inputNormalizado) ||
    inputNormalizado.includes(e.nombre.toLowerCase())
  )

  if (especialidadByName) {
    logger.info('Especialidad seleccionada por nombre', {
      especialidadId: especialidadByName.id,
      especialidadNombre: especialidadByName.nombre,
    })

    return {
      handled: true,
      nextPhase: 'awaiting_turno_selection',
      selectedSpecialty: especialidadByName,
    }
  }

  // Input invalido
  logger.info('Seleccion de especialidad invalida', { input: userInput })

  return {
    handled: true,
    message: `No reconozco esa especialidad. Por favor, responde con el *numero* de la especialidad (1-${especialidadesOpciones.length}).`,
    nextPhase: 'awaiting_specialty_selection',
  }
}

/**
 * Mensaje de error cuando no se pueden obtener especialidades
 */
export function buildSpecialtiesErrorMessage(): string {
  return 'No pude obtener las especialidades disponibles en este momento. Por favor, intenta nuevamente en unos minutos.'
}
