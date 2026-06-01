/**
 * Sprint 4: Selección de Turnos por Número
 *
 * Cuando el usuario tiene múltiples turnos y responde con "1", "2", "3",
 * el backend detecta la selección directamente sin pasar a OpenAI.
 *
 * El estado "awaiting_turn_selection" se activa desde OpenAI (vía tool call)
 * y persiste en Redis. El backend lo intercepta en mensajes posteriores.
 */

import { createConversationLogger } from "./logger"
import { getConversationContext, setConversationContext } from "./redis"
import { ConversationPhase } from "./types"
import { getRedisClient } from "@/lib/redis"
import { extractSelection, createOptionsFromLabels, SelectionResult } from "./selection-extractor"

const TURN_SELECTION_PREFIX = "turn_selection:"
const TTL_SECONDS = 30 * 60 // 30 minutos

/**
 * Datos de un turno disponible para selección
 */
export interface SelectableTurn {
  index: number
  fecha: string
  hora: string
  profesional: string
  sede: string
  turnoId?: string
  agendaId?: string
  admiteReagendamiento?: boolean
}

/**
 * Estado de selección guardado en Redis
 */
export interface TurnSelectionState {
  phase: "awaiting_turn_selection" | "awaiting_action_selection"
  turnos: SelectableTurn[]
  selectedTurnoIndex?: number
  createdAt: string
  source: "router" | "reagendamiento" | "paciente_existente"
}

/**
 * Guardar el estado de selección de turnos en Redis
 * Se llama cuando OpenAI lista los turnos disponibles
 */
export async function saveTurnSelectionState(
  phone: string,
  configId: string,
  turnos: SelectableTurn[],
  phase: TurnSelectionState["phase"] = "awaiting_turn_selection",
  source: TurnSelectionState["source"] = "router"
): Promise<void> {
  const logger = createConversationLogger(phone, configId, phase)
  try {
    const redis = getRedisClient()
    if (!redis) {
      logger.warn("Redis no disponible para guardar turn selection state")
      return
    }

    const key = `${TURN_SELECTION_PREFIX}${configId}:${phone}`
    const state: TurnSelectionState = {
      phase,
      turnos,
      createdAt: new Date().toISOString(),
      source,
    }

    await redis.setex(key, TTL_SECONDS, JSON.stringify(state))
    logger.info("Estado de seleccion guardado", { turnosCount: turnos.length, phase, source })
  } catch (error) {
    logger.error("Error guardando turn selection state", error as Error)
  }
}

/**
 * Obtener el estado de selección de turnos de Redis
 */
export async function getTurnSelectionState(
  phone: string,
  configId: string
): Promise<TurnSelectionState | null> {
  try {
    const redis = getRedisClient()
    if (!redis) return null

    const key = `${TURN_SELECTION_PREFIX}${configId}:${phone}`
    const data = await redis.get(key)
    if (!data) return null

    // Upstash Redis puede devolver objeto ya parseado o string
    if (typeof data === 'object') {
      return data as TurnSelectionState
    }
    return JSON.parse(data as string) as TurnSelectionState
  } catch (error) {
    console.error(`[TURN-SELECTION] Error obteniendo estado para ${phone}:`, error)
    return null
  }
}

/**
 * Limpiar el estado de selección
 */
export async function clearTurnSelectionState(
  phone: string,
  configId: string
): Promise<void> {
  try {
    const redis = getRedisClient()
    if (!redis) return
    const key = `${TURN_SELECTION_PREFIX}${configId}:${phone}`
    await redis.del(key)
  } catch (error) {
    console.error(`[TURN-SELECTION] Error limpiando estado para ${phone}:`, error)
  }
}

/**
 * Resultado de la interceptación de selección
 */
export type TurnSelectionResult =
  | { handled: false }
  | { handled: true; type: "invalid_selection"; maxTurnos: number }
  | { handled: true; type: "turn_selected"; turno: SelectableTurn; state: TurnSelectionState }

/**
 * Intentar interceptar una selección numérica de turno
 * Retorna handled: false si no corresponde procesarlo aquí
 */
export async function handleTurnSelectionIfPending(
  userMessage: string,
  phone: string,
  configId: string
): Promise<TurnSelectionResult> {
  const logger = createConversationLogger(phone, configId, "awaiting_turn_selection")

  try {
    // Solo actuar si hay un estado pendiente
    const state = await getTurnSelectionState(phone, configId)
    if (!state) {
      return { handled: false }
    }

    // Extraer número del mensaje (acepta "1", " 1 ", "opcion 1", "la 1", etc.)
    const selectedNumber = extractSelectionNumber(userMessage)

    if (selectedNumber === null) {
      logger.debug("Mensaje no es una seleccion numerica valida", { userMessage })
      // Puede ser texto libre - dejar pasar a OpenAI para que interprete
      return { handled: false }
    }

    const turnoIndex = selectedNumber - 1 // convertir a 0-based

    if (turnoIndex < 0 || turnoIndex >= state.turnos.length) {
      logger.warn("Seleccion fuera de rango", { selectedNumber, maxTurnos: state.turnos.length })
      return {
        handled: true,
        type: "invalid_selection",
        maxTurnos: state.turnos.length,
      }
    }

    const turnoSeleccionado = state.turnos[turnoIndex]
    logger.info("Turno seleccionado correctamente", {
      selectedNumber,
      fecha: turnoSeleccionado.fecha,
      profesional: turnoSeleccionado.profesional,
    })

    // Actualizar el estado con la selección
    state.selectedTurnoIndex = turnoIndex
    const redis = getRedisClient()
    if (redis) {
      const key = `${TURN_SELECTION_PREFIX}${configId}:${phone}`
      await redis.setex(key, TTL_SECONDS, JSON.stringify(state))
    }

    return {
      handled: true,
      type: "turn_selected",
      turno: turnoSeleccionado,
      state,
    }
  } catch (error) {
    logger.error("Error en handleTurnSelectionIfPending", error as Error)
    return { handled: false }
  }
}

/**
 * Extrae un número de selección usando el extractor inteligente
 * Usa múltiples capas: directo, letras, ordinales, positicionales, texto, fuzzy
 * 
 * @deprecated Usar extractSelection() directamente del selection-extractor.ts
 * Se mantiene por compatibilidad hacia atrás
 */
export function extractSelectionNumber(message: string): number | null {
  // Para turnos, generamos opciones simples solo con índices
  // El método nuevo espera SelectionOption[], así que creamos placeholders
  const dummyOptions = Array.from({ length: 20 }, (_, i) => ({
    index: i,
    label: `Opción ${i + 1}`,
  }))

  const result = extractSelection(message, dummyOptions)
  
  // Si se detectó una selección, retorna el índice + 1 (formato 1-based)
  if (result.selected && result.selectedIndex !== undefined) {
    return result.selectedIndex + 1
  }

  return null
}

/**
 * Genera el mensaje de seleccion invalida
 */
export function buildInvalidSelectionMessage(maxTurnos: number): string {
  const opciones = Array.from({ length: maxTurnos }, (_, i) => `${i + 1}`).join(", ")
  return `Por favor, respondé con un número entre 1 y ${maxTurnos}. Las opciones disponibles son: ${opciones}.`
}

/**
 * Genera el mensaje de confirmacion de turno seleccionado
 * (Previo a la acción - confirmar o cancelar)
 */
export function buildTurnSelectedMessage(turno: SelectableTurn): string {
  const fecha = formatTurnDate(turno.fecha)
  const hora = turno.hora.substring(0, 5)

  return `Seleccionaste el turno del ${fecha} a las ${hora} con ${turno.profesional} en ${turno.sede}.

¿Qué querés hacer con este turno?
1- Confirmar asistencia
2- Cancelar turno`
}

// Helpers de formato
function formatTurnDate(fecha: string): string {
  try {
    const date = new Date(fecha + "T00:00:00")
    const days = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]
    const months = [
      "enero", "febrero", "marzo", "abril", "mayo", "junio",
      "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
    ]
    return `${days[date.getDay()]} ${date.getDate()} de ${months[date.getMonth()]}`
  } catch {
    return fecha
  }
}
