/**
 * appointment-flow-state.ts
 * 
 * Maneja el estado del flujo de confirmacion/cancelacion de turnos
 * para permitir respuestas directas sin pasar por OpenAI.
 * 
 * Dos responsabilidades:
 * 1. Context: Guardar/leer Chatbot_Data estructurado (datos del turno)
 * 2. FlowState: Guardar/leer el estado del flujo pendiente (ej: awaiting_cancel_confirmation)
 */

import { getRedisClient } from "./redis"

// ============================================================================
// TYPES
// ============================================================================

export interface ChatbotDataPaciente {
  nombres: string
  apellido: string
  dni: string
  telefono: string
  mail?: string
  obra_social_id?: string
  obra_social_nombre?: string
}

export interface ChatbotDataTurno {
  fecha: string
  fecha_formateada: string
  hora: string
  hora_formateada: string
  profesional: string
  profesional_id: string
  sede: string
  direccion: string
  agenda_id: string
  admite_reagendamiento: boolean
  tipo: string
}

export interface ChatbotData {
  paciente: ChatbotDataPaciente
  turnos: ChatbotDataTurno[]
  turnos_qx?: ChatbotDataTurno[]
  cantidad_turnos: number
  cantidad_cirugias?: number
  tiene_cirugias?: boolean
  sede_id: string
  clinica: string
  tipo_mensaje: string
}

export type FlowStateType = 
  | 'awaiting_cancel_confirmation'
  | 'awaiting_reschedule_choice'

export interface FlowState {
  type: FlowStateType
  createdAt: string
  // Datos adicionales que puedan necesitarse durante el flujo
  turnoIndex?: number // Cual turno se esta cancelando (si hay multiples)
}

// ============================================================================
// REDIS KEYS
// ============================================================================

const CONTEXT_PREFIX = "appointment_context"
const FLOW_STATE_PREFIX = "appointment_flow"

// TTLs en segundos
const CONTEXT_TTL = 48 * 60 * 60 // 48 horas - el contexto del turno
const FLOW_STATE_TTL = 30 * 60   // 30 minutos - el estado del flujo pendiente

function getContextKey(phone: string, configId: string): string {
  return `${CONTEXT_PREFIX}:${configId}:${phone}`
}

function getFlowStateKey(phone: string, configId: string): string {
  return `${FLOW_STATE_PREFIX}:${configId}:${phone}`
}

// ============================================================================
// CONTEXT FUNCTIONS (Chatbot_Data)
// ============================================================================

/**
 * Guarda el Chatbot_Data estructurado cuando se envia un template
 */
export async function saveAppointmentContext(
  phone: string,
  configId: string,
  chatbotData: ChatbotData
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    console.warn("[APPOINTMENT-FLOW] Redis no disponible, no se puede guardar contexto")
    return false
  }

  try {
    const key = getContextKey(phone, configId)
    await redis.set(key, JSON.stringify(chatbotData), { ex: CONTEXT_TTL })
    console.log(`[APPOINTMENT-FLOW] Contexto guardado para ${phone} (config: ${configId})`)
    return true
  } catch (error) {
    console.error("[APPOINTMENT-FLOW] Error guardando contexto:", error)
    return false
  }
}

/**
 * Obtiene el Chatbot_Data guardado para un telefono/config
 */
export async function getAppointmentContext(
  phone: string,
  configId: string
): Promise<ChatbotData | null> {
  const redis = getRedisClient()
  if (!redis) {
    console.warn("[APPOINTMENT-FLOW] Redis no disponible, no se puede obtener contexto")
    return null
  }

  try {
    const key = getContextKey(phone, configId)
    const data = await redis.get<string>(key)
    
    if (!data) {
      console.log(`[APPOINTMENT-FLOW] No hay contexto para ${phone} (config: ${configId})`)
      return null
    }

    // Redis puede devolver el objeto ya parseado o un string
    if (typeof data === 'object') {
      return data as unknown as ChatbotData
    }
    
    return JSON.parse(data) as ChatbotData
  } catch (error) {
    console.error("[APPOINTMENT-FLOW] Error obteniendo contexto:", error)
    return null
  }
}

/**
 * Elimina el contexto del turno (llamar despues de cancelar exitosamente)
 */
export async function clearAppointmentContext(
  phone: string,
  configId: string
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false

  try {
    const key = getContextKey(phone, configId)
    await redis.del(key)
    console.log(`[APPOINTMENT-FLOW] Contexto eliminado para ${phone}`)
    return true
  } catch (error) {
    console.error("[APPOINTMENT-FLOW] Error eliminando contexto:", error)
    return false
  }
}

// ============================================================================
// FLOW STATE FUNCTIONS
// ============================================================================

/**
 * Establece el estado del flujo pendiente (ej: esperando confirmacion de cancelacion)
 */
export async function setFlowState(
  phone: string,
  configId: string,
  state: FlowState
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    console.warn("[APPOINTMENT-FLOW] Redis no disponible, no se puede guardar estado de flujo")
    return false
  }

  try {
    const key = getFlowStateKey(phone, configId)
    await redis.set(key, JSON.stringify(state), { ex: FLOW_STATE_TTL })
    console.log(`[APPOINTMENT-FLOW] Estado de flujo '${state.type}' guardado para ${phone}`)
    return true
  } catch (error) {
    console.error("[APPOINTMENT-FLOW] Error guardando estado de flujo:", error)
    return false
  }
}

/**
 * Obtiene el estado del flujo pendiente
 */
export async function getFlowState(
  phone: string,
  configId: string
): Promise<FlowState | null> {
  const redis = getRedisClient()
  if (!redis) return null

  try {
    const key = getFlowStateKey(phone, configId)
    const data = await redis.get<string>(key)
    
    if (!data) return null

    // Redis puede devolver el objeto ya parseado o un string
    if (typeof data === 'object') {
      return data as unknown as FlowState
    }
    
    return JSON.parse(data) as FlowState
  } catch (error) {
    console.error("[APPOINTMENT-FLOW] Error obteniendo estado de flujo:", error)
    return null
  }
}

/**
 * Limpia el estado del flujo (cuando se completa o se abandona)
 */
export async function clearFlowState(
  phone: string,
  configId: string
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false

  try {
    const key = getFlowStateKey(phone, configId)
    await redis.del(key)
    console.log(`[APPOINTMENT-FLOW] Estado de flujo limpiado para ${phone}`)
    return true
  } catch (error) {
    console.error("[APPOINTMENT-FLOW] Error limpiando estado de flujo:", error)
    return false
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Detecta si una respuesta del usuario es una confirmacion de cancelacion ("1", "si", etc)
 */
export function isConfirmCancelResponse(message: string): boolean {
  const normalized = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita acentos
    .trim()

  // Respuestas que confirman la cancelacion
  const confirmPatterns = [
    /^1\.?$/,           // "1" o "1."
    /^si\.?$/,          // "si" o "si."
    /^s$/,              // "s"
    /cancelar/,         // contiene "cancelar"
    /^si,?\s*cancelar/, // "si, cancelar" o "si cancelar"
  ]

  return confirmPatterns.some(pattern => pattern.test(normalized))
}

/**
 * Detecta si una respuesta del usuario es para mantener el turno ("2", "no", etc)
 */
export function isKeepAppointmentResponse(message: string): boolean {
  const normalized = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()

  // Respuestas que mantienen el turno
  const keepPatterns = [
    /^2\.?$/,           // "2" o "2."
    /^no\.?$/,          // "no" o "no."
    /^n$/,              // "n"
    /mantener/,         // contiene "mantener"
    /^no,?\s*mantener/, // "no, mantener" o "no mantener"
  ]

  return keepPatterns.some(pattern => pattern.test(normalized))
}

/**
 * Detecta si el usuario quiere reagendar ("1") o no reagendar ("2")
 * despues de una cancelacion exitosa
 */
export function isRescheduleChoice(message: string): 'reschedule' | 'no_reschedule' | null {
  const normalized = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()

  // Quiere reagendar
  if (/^1\.?$/.test(normalized) || /reagendar/.test(normalized)) {
    return 'reschedule'
  }

  // No quiere reagendar
  if (/^2\.?$/.test(normalized) || /no\s*(quiero\s*)?reagendar/.test(normalized)) {
    return 'no_reschedule'
  }

  return null
}
