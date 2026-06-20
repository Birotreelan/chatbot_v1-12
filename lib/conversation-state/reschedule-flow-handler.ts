/**
 * reschedule-flow-handler.ts
 * 
 * Handler deterministico para flujo de reagendamiento post-cancelacion.
 * Maneja TODO el flujo sin pasar por OpenAI, excepto para interpretar texto libre.
 * 
 * Fases:
 * 1. showing_turns - Mostrar lista de turnos disponibles
 * 2. awaiting_selection - Esperar que usuario seleccione turno
 * 3. awaiting_confirmation - Esperar confirmacion de datos del turno
 * 4. completed - Reserva ejecutada exitosamente
 */

import { getRedisClient } from "@/lib/redis"
import { extractSelection, SelectionResult } from "./selection-extractor"
import type { ChatbotData, ChatbotDataTurno } from "../appointment-flow-state"

// ============================================================================
// TYPES
// ============================================================================

export interface TurnoDisponible {
  id: string
  fecha: string
  fecha_formateada: string
  hora: string
  hora_formateada: string
  profesional: string
  profesional_id: string
  sede: string
  direccion: string
  agenda_id: string
  disponibilidad: number // 0=no disponible, >0=disponible
}

export type ReschedulePhase = 
  | 'showing_turns'
  | 'awaiting_selection'
  | 'awaiting_confirmation'
  | 'completed'
  | 'awaiting_search_type'  // Sin turnos con el mismo profesional; esperando opción 1/2/3

export interface RescheduleFlowState {
  phase: ReschedulePhase
  paciente: {
    nombres: string
    apellido: string
    dni: string
    telefono: string
  }
  profesional_id: string
  sede_id: string
  obra_social_id?: string   // Para búsqueda ampliada con filtro de obra social
  paciente_dni?: string     // Para búsqueda ampliada: filtra turnos por DNI/obra social
  profesional_original?: string // Nombre del profesional del turno cancelado
  turnosCancelado: {
    fecha: string
    hora: string
    profesional: string
  }
  turnosDisponibles: TurnoDisponible[]
  turnoSeleccionado: TurnoDisponible | null
  turnoReservado: TurnoDisponible | null
  createdAt: string
  updatedAt: string
  intentosFallidos: number // contador de intentos fallidos
}

export interface RescheduleFlowResult {
  type: 'success' | 'pending' | 'fallback_to_openai' | 'error' | 'completed'
  message?: string
  nextPhase?: ReschedulePhase
  turnoSeleccionado?: TurnoDisponible
  state?: RescheduleFlowState
  fallbackContext?: {
    intent: string
    extractedData?: Record<string, any>
    originalMessage: string
    // Campos adicionales para búsqueda ampliada post-60-días
    searchType?: string
    pacienteDni?: string
    obraSocialId?: string
    sedeId?: string
    paciente?: {
      nombres: string
      apellido: string
      dni: string
      telefono: string
    }
  }
}

// ============================================================================
// REDIS KEYS
// ============================================================================

const RESCHEDULE_STATE_PREFIX = "reschedule_flow"
const RESCHEDULE_STATE_TTL = 2 * 60 * 60 // 2 horas

function getRescheduleStateKey(phone: string, configId: string): string {
  return `${RESCHEDULE_STATE_PREFIX}:${configId}:${phone}`
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

export async function saveRescheduleState(
  phone: string,
  configId: string,
  state: RescheduleFlowState
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    console.warn("[RESCHEDULE-FLOW] Redis no disponible")
    return false
  }

  try {
    const key = getRescheduleStateKey(phone, configId)
    state.updatedAt = new Date().toISOString()
    await redis.set(key, JSON.stringify(state), { ex: RESCHEDULE_STATE_TTL })
    console.log(`[RESCHEDULE-FLOW] Estado guardado para ${phone} (fase: ${state.phase})`)
    return true
  } catch (error) {
    console.error("[RESCHEDULE-FLOW] Error guardando estado:", error)
    return false
  }
}

export async function getRescheduleState(
  phone: string,
  configId: string
): Promise<RescheduleFlowState | null> {
  const redis = getRedisClient()
  if (!redis) return null

  try {
    const key = getRescheduleStateKey(phone, configId)
    const data = await redis.get<string>(key)
    
    if (!data) return null

    if (typeof data === 'object') {
      return data as unknown as RescheduleFlowState
    }
    
    return JSON.parse(data) as RescheduleFlowState
  } catch (error) {
    console.error("[RESCHEDULE-FLOW] Error obteniendo estado:", error)
    return null
  }
}

export async function clearRescheduleState(
  phone: string,
  configId: string
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false

  try {
    const key = getRescheduleStateKey(phone, configId)
    await redis.del(key)
    console.log(`[RESCHEDULE-FLOW] Estado limpiado para ${phone}`)
    return true
  } catch (error) {
    console.error("[RESCHEDULE-FLOW] Error limpiando estado:", error)
    return false
  }
}

// ============================================================================
// HELPERS DE DETECCION
// ============================================================================

/**
 * Detecta si el usuario confirma (si, dale, 1, etc)
 */
export function isConfirmation(message: string): boolean {
  const normalized = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()

  const confirmPatterns = [
    /^1\.?$/,
    /^(si|s)\.?$/,
    /^(dale|ok|claro|perfecto|listo)\.?$/,
    /^(confirmar|confirmaste|reservar|reserva)\.?$/,
  ]

  return confirmPatterns.some(p => p.test(normalized))
}

/**
 * Detecta si el usuario rechaza (no, 2, otro, etc)
 */
export function isRejection(message: string): boolean {
  const normalized = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()

  const rejectPatterns = [
    /^2\.?$/,
    /^(no|n)\.?$/,
    /^(otro|otros|ninguno)\.?$/,
    /^(volver|atras|anterior)\.?$/,
  ]

  return rejectPatterns.some(p => p.test(normalized))
}

/**
 * Detecta si el usuario quiere abandonar (chau, gracias no, dejalo, etc)
 */
export function isAbandon(message: string): boolean {
  const normalized = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()

  const abandonPatterns = [
    /^(chau|adios|bye|hasta|nos vemos)\.?$/,
    /^(dejalo|dejemos|nah|olvida)\.?$/,
    /^(gracias\s+(no|nah)|no\s+gracias)\.?$/,
    /^(no\s*quiero\s*reagendar|no\s*me\s*interesa)\.?$/,
  ]

  return abandonPatterns.some(p => p.test(normalized))
}

// ============================================================================
// HANDLER PRINCIPAL
// ============================================================================

/**
 * Inicia el flujo de reagendamiento
 * Se llama cuando el usuario elige "1. Reagendar" despues de cancelar
 */
export async function initRescheduleFlow(
  chatbotData: ChatbotData,
  turnosDisponibles: TurnoDisponible[],
  phone: string,
  configId: string
): Promise<RescheduleFlowResult> {
  console.log(`[RESCHEDULE-FLOW] Iniciando flujo de reagendamiento para ${phone}`)

  if (!turnosDisponibles || turnosDisponibles.length === 0) {
    console.warn(`[RESCHEDULE-FLOW] No hay turnos disponibles`)
    return {
      type: 'error',
      message: "Lo siento, no hay turnos disponibles en este momento para ese profesional.",
    }
  }

  const turno = chatbotData.turnos[0]
  const state: RescheduleFlowState = {
    phase: 'showing_turns',
    paciente: {
      nombres: chatbotData.paciente.nombres,
      apellido: chatbotData.paciente.apellido,
      dni: chatbotData.paciente.dni,
      telefono: chatbotData.paciente.telefono,
    },
    profesional_id: turno.profesional_id,
    sede_id: chatbotData.sede_id,
    turnosCancelado: {
      fecha: turno.fecha,
      hora: turno.hora,
      profesional: turno.profesional,
    },
    turnosDisponibles,
    turnoSeleccionado: null,
    turnoReservado: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    intentosFallidos: 0,
  }

  await saveRescheduleState(phone, configId, state)

  return {
    type: 'pending',
    nextPhase: 'awaiting_selection',
    state,
  }
}

/**
 * Procesa un mensaje del usuario durante el flujo
 */
export async function handleRescheduleMessage(
  message: string,
  state: RescheduleFlowState | null,
  phone: string,
  configId: string
): Promise<RescheduleFlowResult> {
  
  // Si no hay estado, inicializar
  if (!state) {
    console.log(`[RESCHEDULE-FLOW] No hay estado, error interno`)
    return {
      type: 'error',
      message: "Error interno. Por favor, intenta nuevamente.",
    }
  }

  console.log(`[RESCHEDULE-FLOW] Procesando mensaje en fase: ${state.phase}`)

  // Fase 1: Mostrar turnos (nunca debe llegar aqui, pero por seguridad)
  if (state.phase === 'showing_turns') {
    state.phase = 'awaiting_selection'
    await saveRescheduleState(phone, configId, state)
    return {
      type: 'pending',
      nextPhase: 'awaiting_selection',
      state,
    }
  }

  // Fase 2: Esperando seleccion de turno
  if (state.phase === 'awaiting_selection') {
    // Intentar resolver con backend
    const selection = extractSelection(message, state.turnosDisponibles.map((t, i) => ({
      label: `${t.fecha_formateada} - ${t.hora_formateada} hs`,
      value: i,
    })))

    console.log(`[RESCHEDULE-FLOW] Selection extractor result:`, selection)

    if (selection.resolved && selection.value !== undefined) {
      const turnoIndex = selection.value as number
      const turnoSeleccionado = state.turnosDisponibles[turnoIndex]

      if (turnoSeleccionado) {
        console.log(`[RESCHEDULE-FLOW] Turno seleccionado: ${turnoSeleccionado.fecha_formateada} ${turnoSeleccionado.hora_formateada}`)
        
        state.turnoSeleccionado = turnoSeleccionado
        state.phase = 'awaiting_confirmation'
        state.intentosFallidos = 0
        await saveRescheduleState(phone, configId, state)

        return {
          type: 'pending',
          nextPhase: 'awaiting_confirmation',
          turnoSeleccionado,
          state,
        }
      }
    }

    // No se pudo resolver → fallback a OpenAI
    state.intentosFallidos++
    await saveRescheduleState(phone, configId, state)

    if (state.intentosFallidos <= 2) {
      console.log(`[RESCHEDULE-FLOW] Selection no resuelta, intento ${state.intentosFallidos}, fallback a OpenAI`)
      return {
        type: 'fallback_to_openai',
        fallbackContext: {
          intent: 'interpret_turn_selection',
          originalMessage: message,
        },
      }
    } else {
      // Demasiados intentos fallidos
      return {
        type: 'error',
        message: "No pude entender tu seleccion. Por favor, responde con un numero o describa el turno de forma clara.",
      }
    }
  }

  // Fase 3: Esperando confirmacion
  if (state.phase === 'awaiting_confirmation') {
    if (isConfirmation(message)) {
      console.log(`[RESCHEDULE-FLOW] Confirmacion recibida, ejecutando reserva`)
      state.phase = 'completed'
      state.turnoReservado = state.turnoSeleccionado
      await saveRescheduleState(phone, configId, state)

      return {
        type: 'completed',
        message: "Turno reservado exitosamente",
        state,
      }
    } else if (isRejection(message)) {
      console.log(`[RESCHEDULE-FLOW] Rechazo, volviendo a seleccion`)
      state.phase = 'awaiting_selection'
      state.turnoSeleccionado = null
      state.intentosFallidos = 0
      await saveRescheduleState(phone, configId, state)

      return {
        type: 'pending',
        nextPhase: 'awaiting_selection',
        state,
      }
    } else if (isAbandon(message)) {
      console.log(`[RESCHEDULE-FLOW] Usuario abandona el flujo`)
      await clearRescheduleState(phone, configId)

      return {
        type: 'error',
        message: "Entendido. Si cambias de idea, puedo ayudarte a reagendar en cualquier momento.",
      }
    } else {
      // Ambiguo → OpenAI
      console.log(`[RESCHEDULE-FLOW] Confirmacion ambigua, fallback a OpenAI`)
      return {
        type: 'fallback_to_openai',
        fallbackContext: {
          intent: 'clarify_confirmation',
          originalMessage: message,
        },
      }
    }
  }

  // Fase 4: Completada (no deberia recibir mensajes aqui)
  if (state.phase === 'completed') {
    await clearRescheduleState(phone, configId)
    return {
      type: 'error',
      message: "El flujo de reagendamiento ya ha sido completado.",
    }
  }

  // Fase 5: Esperando opción de búsqueda ampliada (1/2/3)
  if (state.phase === 'awaiting_search_type') {
    const normalized = message.trim().toLowerCase()
    const isOp1 = /^1\.?$/.test(normalized) || /m[eé]dico|profesional|particular/.test(normalized)
    const isOp2 = /^2\.?$/.test(normalized) || /especialidad/.test(normalized)
    const isOp3 = /^3\.?$/.test(normalized) || /cualquier|disponible/.test(normalized)

    if (isOp1 || isOp2 || isOp3) {
      const searchType = isOp1 ? 'por_profesional' : isOp2 ? 'por_especialidad' : 'cualquier_medico'
      console.log(`[RESCHEDULE-FLOW] Búsqueda ampliada seleccionada: ${searchType}`)
      await clearRescheduleState(phone, configId)
      return {
        type: 'fallback_to_openai',
        fallbackContext: {
          intent: 'reschedule_broad_search',
          searchType,
          originalMessage: message,
          pacienteDni: state.paciente_dni,
          obraSocialId: state.obra_social_id,
          sedeId: state.sede_id,
          paciente: state.paciente,
        },
      }
    }

    // Respuesta no reconocida
    return {
      type: 'pending',
      nextPhase: 'awaiting_search_type',
      state,
    }
  }

  return {
    type: 'error',
    message: "Error interno procesando tu mensaje.",
  }
}

/**
 * Finaliza el flujo despues de una reserva exitosa
 */
export async function completeRescheduleFlow(
  phone: string,
  configId: string
): Promise<boolean> {
  return await clearRescheduleState(phone, configId)
}
