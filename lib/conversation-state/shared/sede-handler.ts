/**
 * Handler compartido para seleccion de sedes
 * Reutilizado por flujos de paciente nuevo y existente
 */

import { createConversationLogger } from '../logger'
import { obtenerTodasLasSedes } from '../../api-tools/api-functions'
import { extractSelection } from '../selection-extractor'
import { detectFlowInterruption } from './flow-interruption-handler'
import type { SedeOption, HandlerResult, SharedFlowState } from './types'

/**
 * Convierte un texto a Title Case (CamelCase de palabras)
 * Ejemplo: "SALUD OCULAR CALLAO" → "Salud Ocular Callao"
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
 * Construye las filas para el WhatsApp List Message de sedes.
 * Reutilizable por cualquier flujo (new patient, existing patient).
 */
export function buildSedesListRows(
  sedes: SedeOption[]
): Array<{ id: string; title: string; description?: string }> {
  return sedes.map((s) => ({
    id: String(s.numero),
    title: s.nombre.substring(0, 24),
    description: [s.domicilio, s.localidad].filter(Boolean).join(', ').substring(0, 72),
  }))
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
    message += `Gracias, ${primerNombre}. `
  }

  if (obraSocial) {
    message += `Tu cobertura es *${obraSocial}*.\n\n`
  }

  message += `Para continuar, selecciona la sede donde queres atenderte:\n\n`

  // Listar sedes con formato completo
  sedes.forEach((sede) => {
    let sedeInfo = `${sede.numero}. *${toTitleCase(sede.nombre)}*`

    // Agregar ubicacion si esta disponible
    const ubicacionParts = [sede.domicilio, sede.localidad, sede.provincia]
      .filter(Boolean)
      .map(toTitleCase)
    if (ubicacionParts.length > 0) {
      sedeInfo += `\n   Ubicacion: ${ubicacionParts.join(', ')}`
    }

    message += `${sedeInfo}\n`
  })

  message += `\nRespondé con el número de la sede que preferís o usá el listado para seleccionar una.`
  return message
}

/**
 * Opciones para el interceptor de consultas intercaladas
 */
export interface SedeInterruptionOptions {
  /** Mensaje original con la lista de sedes para re-mostrar al usuario */
  originalSedesMessage: string
  /** Teléfono de la clínica para derivar consultas que el bot no puede responder */
  escalationPhone?: string
}

/**
 * Maneja la seleccion de sede por parte del usuario
 */
export async function handleSedeSelection(
  userInput: string,
  sedesOpciones: SedeOption[],
  phoneNumber: string,
  clientId: string,
  interruptionOptions?: SedeInterruptionOptions
): Promise<HandlerResult & { selectedSede?: SedeOption }> {
  const logger = createConversationLogger(phoneNumber, clientId, 'sede_selection')

  // Usar extractSelection para detectar: numeros, palabras (uno/dos), ordinales (primero/segundo), nombre fuzzy
  const selectionOptions = sedesOpciones.map((s) => ({
    index: s.numero - 1, // 0-based index para extractSelection
    label: s.nombre,
  }))

  const result = extractSelection(userInput, selectionOptions)

  if (result.selected && result.selectedIndex !== undefined) {
    const sedeSeleccionada = sedesOpciones[result.selectedIndex]

    if (sedeSeleccionada) {
      logger.info('Sede seleccionada', {
        matchType: result.matchType,
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

  // Sin coincidencia — verificar si es consulta intercalada (si el feature está habilitado)
  logger.info('Seleccion de sede no reconocida', { input: userInput, matchType: result.matchType })

  if (interruptionOptions) {
    const interruption = await detectFlowInterruption(
      userInput,
      'awaiting_sede',
      { originalPromptMessage: interruptionOptions.originalSedesMessage },
      interruptionOptions.escalationPhone,
      phoneNumber,
      clientId
    )

    if (interruption.isInterruption && interruption.response) {
      logger.info('Consulta intercalada en seleccion de sede, respondiendo sin cambiar fase')
      return {
        handled: true,
        message: interruption.response,
        nextPhase: 'awaiting_sede',
      }
    }
  }

  return {
    handled: true,
    message: `No he encontrado la opcion que elegiste. Por favor ingresa el numero de la sede que prefieras.\n\n_Ejemplo: *1*_`,
    nextPhase: 'awaiting_sede',
  }
}

/**
 * Mensaje de error cuando no se pueden obtener sedes
 */
export function buildSedesErrorMessage(): string {
  return 'No pude obtener las sedes disponibles en este momento. Por favor, intenta nuevamente en unos minutos o comunicate directamente con la clinica.'
}
