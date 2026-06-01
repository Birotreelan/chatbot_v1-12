/**
 * Handler compartido para seleccion de sedes
 * Reutilizado por flujos de paciente nuevo y existente
 * 
 * Usa Smart Selection Handler para deteccion inteligente:
 * - Match por numero exacto
 * - Fuzzy matching por texto
 * - NLU fallback para distinguir seleccion de otras consultas
 */

import { createConversationLogger } from '../logger'
import { obtenerTodasLasSedes } from '../../api-tools/api-functions'
import type { SedeOption, HandlerResult, SharedFlowState } from './types'
import { 
  detectSmartSelection, 
  sedeToSelectionOption,
  type SmartSelectionResult 
} from './smart-selection-handler'

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
 * Usa Smart Selection Handler para deteccion inteligente
 */
export async function handleSedeSelection(
  userInput: string,
  sedesOpciones: SedeOption[],
  phoneNumber: string,
  clientId: string
): Promise<HandlerResult & { selectedSede?: SedeOption }> {
  const logger = createConversationLogger(phoneNumber, clientId, 'sede_selection')

  // Convertir SedeOption a SelectionOption para el smart matcher
  const selectionOptions = sedesOpciones.map(sedeToSelectionOption)

  // Usar deteccion inteligente
  const result = await detectSmartSelection(
    userInput,
    selectionOptions,
    'seleccionar la sede donde quiere atenderse',
    true // usar NLU
  )

  logger.info('Smart selection result', {
    matched: result.matched,
    matchType: result.matchType,
    confidence: result.confidence,
    isOtherIntent: result.isOtherIntent,
  })

  // Si se detecto la opcion
  if (result.matched && result.selectedOption) {
    // Encontrar la sede original por ID
    const sedeSeleccionada = sedesOpciones.find(s => s.id === result.selectedOption!.id)

    if (sedeSeleccionada) {
      logger.info('Sede seleccionada', {
        matchType: result.matchType,
        sedeId: sedeSeleccionada.id,
        sedeName: sedeSeleccionada.nombre,
        confidence: result.confidence,
      })

      return {
        handled: true,
        nextPhase: 'awaiting_search_type',
        selectedSede: sedeSeleccionada,
      }
    }
  }

  // Si es otra intencion (consulta, despedida, etc.)
  if (result.isOtherIntent && result.otherIntentResponse) {
    logger.info('Otra intencion detectada', {
      type: result.otherIntentType,
    })

    // Responder a la consulta y recordar que debe seleccionar sede
    const sedeListRecap = sedesOpciones
      .map(s => `${s.numero}. ${s.nombre}`)
      .join('\n')

    return {
      handled: true,
      message: `${result.otherIntentResponse}\n\nPara continuar, por favor indica el *numero* de la sede:\n\n${sedeListRecap}`,
      nextPhase: 'awaiting_sede',
    }
  }

  // No se pudo detectar - pedir seleccion numerica
  const errorMsg = result.errorMessage || 
    `No reconozco esa opcion. Por favor, responde con el *numero* de la sede (1-${sedesOpciones.length}).`

  logger.info('Seleccion de sede no detectada', { input: userInput })

  return {
    handled: true,
    message: errorMsg,
    nextPhase: 'awaiting_sede',
  }
}

/**
 * Mensaje de error cuando no se pueden obtener sedes
 */
export function buildSedesErrorMessage(): string {
  return 'No pude obtener las sedes disponibles en este momento. Por favor, intenta nuevamente en unos minutos o comunicate directamente con la clinica.'
}
