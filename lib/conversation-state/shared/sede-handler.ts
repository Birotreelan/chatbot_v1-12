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

  // 1. Intentar extraer numero exacto
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

  // 2. Detectar numeros escritos en palabras (ej: "cinco", "el quinto")
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
      const sedeSeleccionada = sedesOpciones.find((s) => s.numero === numero)

      if (sedeSeleccionada) {
        logger.info('Sede seleccionada por numero en palabras', {
          palabra,
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
  }

  // 3. Intentar match por nombre exacto
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

  // 4. FALLBACK: Si el input es texto (no numérico), sugerir usar el número
  // Esto previene falsos positivos en fuzzy matching
  const esTexto = /[a-zA-ZáéíóúÁÉÍÓÚñÑ]/.test(inputNormalizado)

  if (esTexto) {
    logger.info('Seleccion de sede por texto no reconocido - sugiriendo numero', { 
      input: userInput 
    })

    return {
      handled: true,
      message: `No encontre la sede con ese nombre. Por favor, indica el *numero* de la opcion que preferis (1-${sedesOpciones.length}).`,
      nextPhase: 'awaiting_sede',
    }
  }

  // 5. Numero fuera de rango
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
