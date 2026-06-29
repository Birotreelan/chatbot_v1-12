/**
 * Sprint 6-8: Manejador del flujo de reserva de turnos
 *
 * Responsabilidades del backend (determinísticas):
 * - Almacenar opciones mostradas al usuario (obra social, sedes, profesionales, especialidades, turnos)
 * - Resolver selecciones numéricas sin OpenAI
 * - Detectar selecciones fuera de rango
 * - Mapeo número→turno con exactitud (bug off-by-one observado en producción)
 *
 * Responsabilidades de OpenAI (se mantienen):
 * - Búsqueda acumulativa de turnos (9 rangos)
 * - Búsqueda de profesionales por nombre
 * - Interpretación de selección por hora/fecha/nombre
 * - Extracción de nombre del paciente nuevo
 */

import { getRedisClient } from "@/lib/redis"
import { createConversationLogger } from "./logger"
import { extractSelection, createOptionsFromLabels, SelectionResult } from "./selection-extractor"
import {
  detectAndApplyFilter,
  extractNewSearchDates,
} from "./booking-turno-filter"
import { resolverTextoATurno, resolverTurnoConNLU } from "./shared/turno-selection-handler"
import { detectFlowInterruption } from "./shared/flow-interruption-handler"

// ============================================================================
// TIPOS
// ============================================================================

export type BookingStep =
  | "awaiting_obra_social_selection"   // Esperando que elija obra social de lista
  | "awaiting_sede_selection"          // Esperando que elija sede de lista
  | "awaiting_search_type_selection"   // Esperando 1/2/3 (médico/especialidad/cualquier)
  | "awaiting_profesional_selection"   // Esperando que elija profesional de lista
  | "awaiting_especialidad_selection"  // Esperando que elija especialidad de lista
  | "awaiting_turno_selection"         // Esperando que elija turno de lista (crítico: mapeo exacto)
  | "awaiting_turno_confirmation"      // Esperando confirmación final (si/no)
  | null

export interface ObrasSocialOption {
  numero: number
  id: string
  nombre: string
}

export interface SedeOption {
  numero: number
  id: string
  nombre: string
  domicilio?: string
  localidad?: string
  provincia?: string
}

export interface ProfesionalOption {
  numero: number
  id: string
  nombre: string
  especialidad?: string
  sedeId?: string
}

export interface EspecialidadOption {
  numero: number
  id: string
  nombre: string
}

export interface TurnoOption {
  numero: number
  idTurno: string
  fecha: string
  hora: string
  fechaFormateada: string
  horaFormateada: string
  profesionalNombre: string
  sedeNombre: string
  profesionalId?: string
}

export interface BookingFlowState {
  step: BookingStep
  patientType: "nuevo" | "existente"
  // Opciones almacenadas para resolver selecciones
  obrasSocialOptions?: ObrasSocialOption[]
  sedeOptions?: SedeOption[]
  profesionalOptions?: ProfesionalOption[]
  especialidadOptions?: EspecialidadOption[]
  turnoOptions?: TurnoOption[]
  /** Lista completa antes de aplicar un filtro (para poder restaurar "ver todos") */
  fullTurnoOptions?: TurnoOption[]
  // Selecciones confirmadas
  obraSocialId?: string
  obraSocialNombre?: string
  sedeId?: string
  sedeNombre?: string
  searchType?: "medico_particular" | "especialidad" | "cualquier_medico"
  profesionalId?: string
  profesionalNombre?: string
  especialidadId?: string
  especialidadNombre?: string
  turnoSeleccionado?: TurnoOption
  // Datos del paciente
  patientDni?: string
  patientName?: string
  patientEmail?: string
  // Metadata
  createdAt: string
  updatedAt: string
}

export type BookingSelectionResult =
  | { handled: false }
  | { handled: true; type: "valid_selection"; selectedOption: ObrasSocialOption | SedeOption | ProfesionalOption | EspecialidadOption; nextStep: BookingStep; confirmationMessage: string }
  | { handled: true; type: "valid_turno"; turno: TurnoOption; confirmationMessage: string }
  | { handled: true; type: "invalid_selection"; errorMessage: string }
  | { handled: true; type: "search_type_selected"; searchType: "medico_particular" | "especialidad" | "cualquier_medico"; nextMessage?: string }
  // Nuevos tipos para manejo de texto libre en awaiting_turno_selection
  | { handled: true; type: "turno_filtered"; message: string }
  | { handled: true; type: "no_filter_results"; filterDesc: string }
  | { handled: true; type: "needs_new_date_search"; fechaDesde: string; fechaHasta: string; description: string }
  | { handled: true; type: "booking_exit_flow" }
  | { handled: true; type: "turno_selection_clarify"; clarificationMessage: string }
  | { handled: true; type: "turno_selection_question"; response: string }

// ============================================================================
// REDIS KEYS
// ============================================================================

const BOOKING_FLOW_PREFIX = "booking_flow:"
const BOOKING_FLOW_TTL = 60 * 60 * 3 // 3 horas

function getKey(phone: string, configId: string): string {
  return `${BOOKING_FLOW_PREFIX}${configId}:${phone}`
}

// ============================================================================
// STORAGE
// ============================================================================

export async function getBookingFlowState(
  phone: string,
  configId: string
): Promise<BookingFlowState | null> {
  try {
    const redis = getRedisClient()
    if (!redis) return null
    const data = await redis.get(getKey(phone, configId))
    if (!data) return null
    // Upstash Redis puede devolver objeto ya parseado o string
    if (typeof data === 'object') {
      return data as BookingFlowState
    }
    return JSON.parse(data as string) as BookingFlowState
  } catch {
    return null
  }
}

export async function setBookingFlowState(
  phone: string,
  configId: string,
  state: BookingFlowState
): Promise<void> {
  try {
    const redis = getRedisClient()
    if (!redis) return
    const updated = { ...state, updatedAt: new Date().toISOString() }
    await redis.setex(getKey(phone, configId), BOOKING_FLOW_TTL, JSON.stringify(updated))
  } catch {
    // Silenciar errores de Redis
  }
}

export async function clearBookingFlowState(
  phone: string,
  configId: string
): Promise<void> {
  try {
    const redis = getRedisClient()
    if (!redis) return
    await redis.del(getKey(phone, configId))
  } catch {
    // Silenciar errores de Redis
  }
}

// ============================================================================
// HELPERS DE DETECCIÓN NUMÉRICA
// ============================================================================

/**
 * Extrae un número de selección de un mensaje.
 * Soporta: "2", "el 2", "opción 2", "número 2", "dos", "segundo"
 */
/**
 * Extrae selección numérica usando el extractor inteligente multi-capa
 * 
 * Soporta:
 * - Números directos: "2", "3"
 * - Números en letras: "dos", "tres"
 * - Ordinales: "segundo", "tercero"
 * - Posicionales: "primero", "último"
 * - Coincidencia parcial y fuzzy matching
 * 
 * @deprecated Usar extractSelection() directamente del selection-extractor.ts
 * Se mantiene por compatibilidad hacia atrás
 */
export function extractSelectionNumber(message: string): number | null {
  // Crear opciones dummy para el extractor
  // El método espera SelectionOption[] para hacer fuzzy matching
  const dummyOptions = Array.from({ length: 20 }, (_, i) => ({
    index: i,
    label: `Opción ${i + 1}`,
  }))

  const result = extractSelection(message, dummyOptions)
  
  // Retornar el índice + 1 (formato 1-based para mantener compatibilidad)
  if (result.selected && result.selectedIndex !== undefined) {
    return result.selectedIndex + 1
  }

  return null
}

// ============================================================================
// HANDLER PRINCIPAL
// ============================================================================

/**
 * Maneja una selección numérica del usuario si hay un booking flow activo.
 * Retorna handled=false si no hay estado activo o el input no es una selección numérica simple.
 */
export async function handleBookingSelectionIfPending(
  userMessage: string,
  phone: string,
  configId: string
): Promise<BookingSelectionResult> {
  const logger = createConversationLogger(phone, configId, "booking-flow")

  try {
    const state = await getBookingFlowState(phone, configId)
    if (!state || !state.step) return { handled: false }

    const selectedNum = extractSelectionNumber(userMessage)
    if (selectedNum === null) {
      // Input no numérico
      if (state.step === "awaiting_turno_selection") {
        // Para turno selection, interceptar con NLU en lugar de pasar a OpenAI
        return await handleNonNumericTurnoSelection(userMessage, phone, configId, state, logger)
      }
      // Para otros pasos del booking flow, continuar con OpenAI
      logger.info("Input no numerico en booking flow, pasando a OpenAI", { step: state.step, userMessage })
      return { handled: false }
    }

    logger.info("Seleccion numerica detectada en booking flow", { step: state.step, selectedNum })

    switch (state.step) {

      // ------------------------------------------------------------------
      case "awaiting_obra_social_selection": {
        const options = state.obrasSocialOptions || []
        const found = options.find(o => o.numero === selectedNum)
        if (!found) {
          return {
            handled: true,
            type: "invalid_selection",
            errorMessage: `No encontré la opción ${selectedNum}. Por favor, indicame el número de la obra social que preferís de la lista anterior.`,
          }
        }
        await setBookingFlowState(phone, configId, {
          ...state,
          step: "awaiting_sede_selection",
          obraSocialId: found.id,
          obraSocialNombre: found.nombre,
        })
        return {
          handled: true,
          type: "valid_selection",
          selectedOption: found,
          nextStep: "awaiting_sede_selection",
          confirmationMessage: `Perfecto. Seleccionaste ${found.nombre}. Ahora necesito que elijas la sede donde querés atenderte.`,
        }
      }

      // ------------------------------------------------------------------
      case "awaiting_sede_selection": {
        const options = state.sedeOptions || []
        const found = options.find(o => o.numero === selectedNum)
        if (!found) {
          return {
            handled: true,
            type: "invalid_selection",
            errorMessage: `No encontré la sede con el número ${selectedNum}. Por favor, indicame el número de la sede que preferís de la lista anterior.`,
          }
        }
        await setBookingFlowState(phone, configId, {
          ...state,
          step: "awaiting_search_type_selection",
          sedeId: found.id,
          sedeNombre: found.nombre,
        })
        return {
          handled: true,
          type: "valid_selection",
          selectedOption: found,
          nextStep: "awaiting_search_type_selection",
          confirmationMessage: `Perfecto, elegiste *${found.nombre}*.\n\nAhora decime, ¿cómo te gustaría buscar tu turno?\n\n1. Médico en particular — si ya sabés con qué profesional querés atenderte\n2. Por especialidad — para elegir una especialidad y ver los profesionales disponibles\n3. Cualquier médico disponible — para ver los turnos más próximos\n\nPresioná el botón o respondé con el número.`,
        }
      }

      // ------------------------------------------------------------------
      case "awaiting_search_type_selection": {
        const typeMap: Record<number, "medico_particular" | "especialidad" | "cualquier_medico"> = {
          1: "medico_particular",
          2: "especialidad",
          3: "cualquier_medico",
        }
        const searchType = typeMap[selectedNum]
        if (!searchType) {
          return {
            handled: true,
            type: "invalid_selection",
            errorMessage: `No entendí tu selección. Por favor, respondé con 1, 2 o 3:\n\n1. Médico en particular\n2. Por especialidad\n3. Cualquier médico disponible`,
          }
        }
        await setBookingFlowState(phone, configId, {
          ...state,
          step: searchType === "medico_particular" ? null : null, // OpenAI continúa desde aquí
          searchType,
        })
        return {
          handled: true,
          type: "search_type_selected",
          searchType,
          nextMessage: searchType === "medico_particular"
            ? "Ahora, por favor indicame el nombre del médico con el que deseas solicitar el turno."
            : undefined, // Para especialidad y cualquier_medico, OpenAI ejecuta la búsqueda
        }
      }

      // ------------------------------------------------------------------
      case "awaiting_profesional_selection": {
        const options = state.profesionalOptions || []
        const found = options.find(o => o.numero === selectedNum)
        if (!found) {
          return {
            handled: true,
            type: "invalid_selection",
            errorMessage: `No encontré el médico número ${selectedNum}. Por favor, indicame el número del médico que preferís de la lista anterior.`,
          }
        }
        await setBookingFlowState(phone, configId, {
          ...state,
          step: null, // OpenAI ejecuta la búsqueda de turnos
          profesionalId: found.id,
          profesionalNombre: found.nombre,
        })
        return {
          handled: true,
          type: "valid_selection",
          selectedOption: found,
          nextStep: null,
          confirmationMessage: `Seleccionaste al ${found.nombre}. Buscando turnos disponibles...`,
        }
      }

      // ------------------------------------------------------------------
      case "awaiting_especialidad_selection": {
        const options = state.especialidadOptions || []
        const found = options.find(o => o.numero === selectedNum)
        if (!found) {
          return {
            handled: true,
            type: "invalid_selection",
            errorMessage: `No entendí tu selección de especialidad. Por favor, indicame el número de la especialidad que preferís de la lista anterior (por ejemplo: 1, 2, 3...).`,
          }
        }
        await setBookingFlowState(phone, configId, {
          ...state,
          step: null, // OpenAI ejecuta la búsqueda de turnos
          especialidadId: found.id,
          especialidadNombre: found.nombre,
        })
        return {
          handled: true,
          type: "valid_selection",
          selectedOption: found,
          nextStep: null,
          confirmationMessage: `Seleccionaste ${found.nombre}. Buscando turnos disponibles...`,
        }
      }

      // ------------------------------------------------------------------
      case "awaiting_turno_selection": {
        const options = state.turnoOptions || []
        // CRITICO: buscar por campo `numero`, NUNCA por índice del array
        const found = options.find(o => o.numero === selectedNum)
        if (!found) {
          const maxNum = Math.max(...options.map(o => o.numero))
          return {
            handled: true,
            type: "invalid_selection",
            errorMessage: `No encontré el turno número ${selectedNum}. Por favor, indicame un número entre 1 y ${maxNum}.`,
          }
        }
        await setBookingFlowState(phone, configId, {
          ...state,
          step: "awaiting_turno_confirmation",
          turnoSeleccionado: found,
        })
        const nombrePaciente = state.patientName ? state.patientName.split(" ")[0] : ""
        return {
          handled: true,
          type: "valid_turno",
          turno: found,
          confirmationMessage: buildTurnoConfirmationMessage(found, nombrePaciente),
        }
      }

      default:
        return { handled: false }
    }

  } catch (error) {
    const logger = createConversationLogger(phone, configId, "booking-flow")
    logger.error("Error en handleBookingSelectionIfPending", error as Error)
    return { handled: false }
  }
}

// ============================================================================
// HANDLER DE TEXTO LIBRE EN AWAITING_TURNO_SELECTION
// ============================================================================

/**
 * Maneja mensajes de texto libre cuando el usuario está en awaiting_turno_selection.
 *
 * Pipeline (orden de prioridad):
 *   1. Exit keywords → booking_exit_flow
 *   2. "ver todos" → restaurar lista completa
 *   3. Filtro determinístico (día/hora/prof) → turno_filtered / no_filter_results
 *   4. Resolver a turno específico por texto (resolverTextoATurno)
 *   5. NLU fallback (resolverTurnoConNLU) → resolved / ambiguous
 *   6. Consulta intercalada (detectFlowInterruption) → turno_selection_question / exit
 *   7. Extracción de fechas para nueva búsqueda → needs_new_date_search
 *   8. Re-prompt genérico
 */
async function handleNonNumericTurnoSelection(
  userMessage: string,
  phone: string,
  configId: string,
  state: BookingFlowState,
  logger: ReturnType<typeof createConversationLogger>
): Promise<BookingSelectionResult> {
  const options = state.turnoOptions || []
  const msg = userMessage.trim().toLowerCase()

  // --- 1. Exit keywords ---
  const exitPatterns = [/^0$/, /\bvolver\b/, /\bcancelar\b/, /\bsalir\b/, /no me interesa/, /lo dejo/, /para otro momento/]
  if (exitPatterns.some(p => p.test(msg))) {
    logger.info("Exit en selección de turno por keyword", { userMessage })
    return { handled: true, type: "booking_exit_flow" }
  }

  // --- 2. "Ver todos" restaura lista completa ---
  if (/ver todos|mostrar todos|todas las opciones/.test(msg) && state.fullTurnoOptions && state.fullTurnoOptions.length > 0) {
    logger.info("Restaurando lista completa de turnos", { total: state.fullTurnoOptions.length })
    const { buildFilteredTurnoListMessage } = await import('./booking-turno-filter')
    await setBookingFlowState(phone, configId, {
      ...state,
      turnoOptions: state.fullTurnoOptions,
      fullTurnoOptions: undefined,
    })
    const restoreMsg = buildFilteredTurnoListMessage(state.fullTurnoOptions, 'todas las fechas disponibles', state.fullTurnoOptions.length)
    return { handled: true, type: "turno_filtered", message: restoreMsg }
  }

  // --- 3. Filtro determinístico (día/hora/profesional) ---
  if (options.length > 0) {
    const { buildFilteredTurnoListMessage, buildNoFilterResultsMessage } = await import('./booking-turno-filter')
    const filterResult = detectAndApplyFilter(userMessage, options)

    if (filterResult.type === 'filtered') {
      logger.info("Filtro aplicado a lista de turnos", { filterDesc: filterResult.filterDesc, resultCount: filterResult.turnos.length })
      await setBookingFlowState(phone, configId, {
        ...state,
        turnoOptions: filterResult.turnos,
        fullTurnoOptions: state.fullTurnoOptions ?? options,
      })
      const message = buildFilteredTurnoListMessage(filterResult.turnos, filterResult.filterDesc, filterResult.originalCount)
      return { handled: true, type: "turno_filtered", message }
    }

    if (filterResult.type === 'no_results') {
      logger.info("Filtro sin resultados", { filterDesc: filterResult.filterDesc })
      // Intentar nueva búsqueda por fechas antes de rendirse
      const newDates = await extractNewSearchDates(userMessage)
      if (newDates) {
        logger.info("Extraídas fechas para nueva búsqueda", { fechaDesde: newDates.fechaDesde, fechaHasta: newDates.fechaHasta })
        return {
          handled: true,
          type: "needs_new_date_search",
          fechaDesde: newDates.fechaDesde,
          fechaHasta: newDates.fechaHasta,
          description: newDates.description,
        }
      }
      // Sin nuevas fechas: re-mostrar lista original con mensaje informativo
      const fullOptions = state.fullTurnoOptions ?? options
      buildNoFilterResultsMessage(filterResult.filterDesc, fullOptions) // built but sent as no_filter_results type
      return { handled: true, type: "no_filter_results", filterDesc: filterResult.filterDesc }
    }
  }

  // --- 4. Resolver a turno específico por texto (determinístico) ---
  // Nota: cast a any necesario porque resolverTextoATurno usa shared/TurnoOption (con campo `id`)
  // mientras que BookingFlowState usa booking/TurnoOption (con `idTurno`). Son duck-type compatibles.
  if (options.length > 0) {
    const resolvedRef = resolverTextoATurno(userMessage, options as any)
    const turnoResuelto = resolvedRef ? options.find(t => t.numero === resolvedRef.numero) : null
    if (turnoResuelto) {
      logger.info("Turno resuelto por texto determinístico", { numero: turnoResuelto.numero })
      await setBookingFlowState(phone, configId, {
        ...state,
        step: "awaiting_turno_confirmation",
        turnoSeleccionado: turnoResuelto,
      })
      const nombrePaciente = state.patientName ? state.patientName.split(' ')[0] : ''
      return { handled: true, type: "valid_turno", turno: turnoResuelto, confirmationMessage: buildTurnoConfirmationMessage(turnoResuelto, nombrePaciente) }
    }
  }

  // --- 5. NLU fallback para resolver turno específico ---
  if (options.length > 0) {
    const nluResult = await resolverTurnoConNLU(userMessage, options as any)

    if (nluResult.outcome === 'resolved') {
      const turnoNLU = options.find(t => t.numero === nluResult.turnoNumero)
      if (turnoNLU) {
        logger.info("Turno resuelto por NLU", { numero: turnoNLU.numero })
        await setBookingFlowState(phone, configId, {
          ...state,
          step: "awaiting_turno_confirmation",
          turnoSeleccionado: turnoNLU,
        })
        const nombrePaciente = state.patientName ? state.patientName.split(' ')[0] : ''
        return { handled: true, type: "valid_turno", turno: turnoNLU, confirmationMessage: buildTurnoConfirmationMessage(turnoNLU, nombrePaciente) }
      }
    }

    if (nluResult.outcome === 'ambiguous') {
      logger.info("NLU detectó ambigüedad", { reasoning: nluResult.reasoning })
      return { handled: true, type: "turno_selection_clarify", clarificationMessage: nluResult.clarificationMessage }
    }

    // outcome === 'unrelated' → continuar al handler de consultas intercaladas
  }

  // --- 6. Consulta intercalada (preguntas sobre precio, dirección, etc.) ---
  const currentOptions = state.turnoOptions || options
  const { buildFilteredTurnoListMessage: buildRelistMsg } = await import('./booking-turno-filter')
  const relistMsg = currentOptions.length > 0
    ? buildRelistMsg(currentOptions, 'las fechas disponibles', currentOptions.length)
    : ''

  const interruption = await detectFlowInterruption(
    userMessage,
    'awaiting_turno_selection',
    { originalPromptMessage: relistMsg },
    undefined,
    phone,
    configId
  )

  if (interruption.isInterruption && interruption.response) {
    logger.info("Consulta intercalada detectada en selección de turno")
    // Si el intent era cancel_flow, limpiar el booking
    if (interruption.response.includes('Entendido.')) {
      return { handled: true, type: "booking_exit_flow" }
    }
    return { handled: true, type: "turno_selection_question", response: interruption.response }
  }

  // --- 7. Última opción: extraer fechas para nueva búsqueda ---
  const newDates = await extractNewSearchDates(userMessage)
  if (newDates) {
    logger.info("Fechas para nueva búsqueda detectadas", { fechaDesde: newDates.fechaDesde, fechaHasta: newDates.fechaHasta })
    return {
      handled: true,
      type: "needs_new_date_search",
      fechaDesde: newDates.fechaDesde,
      fechaHasta: newDates.fechaHasta,
      description: newDates.description,
    }
  }

  // --- 8. Re-prompt genérico ---
  logger.info("Mensaje no reconocido en selección de turno, re-prompting", { userMessage })
  const maxNum = options.length > 0 ? Math.max(...options.map(o => o.numero)) : 1
  return {
    handled: true,
    type: "invalid_selection",
    errorMessage: `No entendí tu respuesta. Por favor, respondé con el *número* del turno que preferís (entre 1 y ${maxNum}), o indicame qué día u horario buscás.`,
  }
}

// ============================================================================
// HELPERS DE CONTEXTO PARA OPENAI
// ============================================================================

/**
 * Genera un bloque de contexto para inyectar al thread de OpenAI.
 * Permite que OpenAI sepa exactamente en qué paso está el flujo
 * sin tener que "recordarlo" del historial.
 */
export function buildBookingContextBlock(state: BookingFlowState): string {
  const lines = [
    `[ESTADO_RESERVA]`,
    `paso_actual: ${state.step || "sin_paso_activo"}`,
    `tipo_paciente: ${state.patientType}`,
  ]

  if (state.obraSocialId) lines.push(`obra_social_id: ${state.obraSocialId}`, `obra_social_nombre: ${state.obraSocialNombre}`)
  if (state.sedeId) lines.push(`sede_id: ${state.sedeId}`, `sede_nombre: ${state.sedeNombre}`)
  if (state.searchType) lines.push(`tipo_busqueda: ${state.searchType}`)
  if (state.profesionalId) lines.push(`profesional_id: ${state.profesionalId}`, `profesional_nombre: ${state.profesionalNombre}`)
  if (state.especialidadId) lines.push(`especialidad_id: ${state.especialidadId}`, `especialidad_nombre: ${state.especialidadNombre}`)
  if (state.patientDni) lines.push(`paciente_dni: ${state.patientDni}`)
  if (state.turnoSeleccionado) {
    const t = state.turnoSeleccionado
    lines.push(`turno_seleccionado_id: ${t.idTurno}`, `turno_fecha: ${t.fecha}`, `turno_hora: ${t.hora}`, `turno_profesional: ${t.profesionalNombre}`)
  }

  return lines.join("\n")
}

// ============================================================================
// TEMPLATES DE CONFIRMACIÓN
// ============================================================================

function buildTurnoConfirmationMessage(turno: TurnoOption, nombrePaciente: string): string {
  const nombre = nombrePaciente ? `${nombrePaciente}, ` : ""
  return `${nombre}confirmá los datos del turno que querés reservar:

Fecha: ${turno.fechaFormateada}
Hora: ${turno.horaFormateada}
Médico: ${turno.profesionalNombre}
Sede: ${turno.sedeNombre}

Escribí *1* para confirmar la reserva o *2* para elegir otro turno.`
}
