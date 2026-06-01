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
      const especialidadSeleccionada = especialidadesOpciones.find((e) => e.numero === numero)
      if (especialidadSeleccionada) {
        logger.info('Especialidad seleccionada por numero en palabras', { palabra, numero })
        return {
          handled: true,
          nextPhase: 'awaiting_turno_selection',
          selectedSpecialty: especialidadSeleccionada,
        }
      }
    }
  }

  // 3. Intentar match por nombre exacto
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

  // 4. FALLBACK: Si es texto no reconocido, pedir numero
  const esTexto = /[a-zA-ZáéíóúÁÉÍÓÚñÑ]/.test(inputNormalizado)

  if (esTexto) {
    logger.info('Seleccion de especialidad por texto no reconocido - sugiriendo numero', { input: userInput })
    return {
      handled: true,
      message: `No encontre la especialidad con ese nombre. Por favor, indica el *numero* de la opcion que preferis (1-${especialidadesOpciones.length}).`,
      nextPhase: 'awaiting_specialty_selection',
    }
  }

  // 5. Numero invalido
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
