/**
 * Handler compartido para seleccion de sedes
 * Reutilizado por flujos de paciente nuevo y existente
 */

import { createConversationLogger } from '../logger'
import { obtenerTodasLasSedes } from '../../api-tools/api-functions'
import type { SedeOption, HandlerResult, SharedFlowState } from './types'

/**
 * Obtiene las sedes desde la API y las formatea
 */
export async function fetchSedes(clientId: string): Promise<{
  success: boolean
  sedes?: SedeOption[]
  error?: string
}> {
  try {
    const result = await obtenerTodasLasSedes(clientId)

    if (!result.success || !result.sedes || result.sedes.length === 0) {
      return {
        success: false,
        error: result.error || 'No se encontraron sedes disponibles',
      }
    }

    // Mapear sedes al formato estandar con numeracion
    const sedesFormateadas: SedeOption[] = result.sedes.map((sede, index) => ({
      numero: index + 1,
      id: sede.Id,
      nombre: sede.Nombre_Completo,
      domicilio: sede.Domicilio,
      localidad: sede.Localidad,
      provincia: sede.Provincia,
      telefono: sede.Telefono,
      email: sede.E_Mail,
      horario: sede.Horario,
    }))

    return {
      success: true,
      sedes: sedesFormateadas,
    }
  } catch (error) {
    console.error('[sede-handler] Error fetching sedes:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error desconocido',
    }
  }
}

/**
 * Construye el mensaje de seleccion de sedes
 */
export function buildSedesMessage(
  sedes: SedeOption[],
  patientName?: string,
  obraSocial?: string
): string {
  let message = ''

  // Encabezado personalizado
  if (patientName) {
    const primerNombre = patientName.split(' ')[0]
    message += `Hola ${primerNombre}, `
  }

  if (obraSocial) {
    message += `tu cobertura es *${obraSocial}*.\n\n`
  }

  message += `Para continuar, selecciona la sede donde queres atenderte:\n\n`

  // Listar sedes con formato completo
  sedes.forEach((sede) => {
    let sedeInfo = `${sede.numero}. *${sede.nombre}*`

    // Agregar ubicacion si esta disponible
    const ubicacionParts = [sede.domicilio, sede.localidad, sede.provincia].filter(Boolean)
    if (ubicacionParts.length > 0) {
      sedeInfo += `\n   Ubicacion: ${ubicacionParts.join(', ')}`
    }

    message += `${sedeInfo}\n`
  })

  message += `\nResponde con el *numero* de la sede que prefieras.`
  return message
}

/**
 * Maneja la seleccion de sede por parte del usuario
 */
export async function handleSedeSelection(
  userInput: string,
  sedesOpciones: SedeOption[],
  phoneNumber: string,
  clientId: string
): Promise<HandlerResult & { selectedSede?: SedeOption }> {
  const logger = createConversationLogger(phoneNumber, clientId, 'sede_selection')

  // Normalizar input
  const inputNormalizado = userInput.trim().toLowerCase()

  // Intentar extraer numero
  const numeroMatch = inputNormalizado.match(/^\d+$/)

  if (numeroMatch) {
    const numero = parseInt(numeroMatch[0], 10)

    // Buscar sede por numero (NO por indice)
    const sedeSeleccionada = sedesOpciones.find((s) => s.numero === numero)

    if (sedeSeleccionada) {
      logger.info('Sede seleccionada por numero', {
        numero,
        sedeId: sedeSeleccionada.id,
        sedeName: sedeSeleccionada.nombre,
      })

      return {
        handled: true,
        nextPhase: 'awaiting_search_type',
        selectedSede: sedeSeleccionada,
      }
    }
  }

  // Si no es un numero valido, intentar match por nombre
  const sedeByName = sedesOpciones.find((s) =>
    s.nombre.toLowerCase().includes(inputNormalizado) ||
    inputNormalizado.includes(s.nombre.toLowerCase())
  )

  if (sedeByName) {
    logger.info('Sede seleccionada por nombre', {
      sedeId: sedeByName.id,
      sedeName: sedeByName.nombre,
    })

    return {
      handled: true,
      nextPhase: 'awaiting_search_type',
      selectedSede: sedeByName,
    }
  }

  // Input invalido
  logger.info('Seleccion de sede invalida', { input: userInput })

  return {
    handled: true,
    message: `No reconozco esa opcion. Por favor, responde con el *numero* de la sede (1-${sedesOpciones.length}).`,
    nextPhase: 'awaiting_sede',
  }
}

/**
 * Mensaje de error cuando no se pueden obtener sedes
 */
export function buildSedesErrorMessage(): string {
  return 'No pude obtener las sedes disponibles en este momento. Por favor, intenta nuevamente en unos minutos o comunicate directamente con la clinica.'
}
