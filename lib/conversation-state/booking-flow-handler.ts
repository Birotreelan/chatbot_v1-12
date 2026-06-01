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
      // Input no numérico - dejar que OpenAI lo interprete (ej: "el de las 11 con Karpec")
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
          confirmationMessage: `Perfecto, buscaremos turnos en ${found.nombre}. Necesito saber si querés un turno con un médico en particular, por especialidad, o con cualquier médico. Por favor, indicame si preferís:\n\n1. Solicitar turno con un médico en particular\n2. Solicitar turno por especialidad\n3. Solicitar turno con cualquier médico`,
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
            errorMessage: `No entendí tu selección. Por favor, indicame el número de la opción que preferís:\n\n1. Solicitar turno con un médico en particular\n2. Solicitar turno por especialidad\n3. Solicitar turno con cualquier médico`,
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
