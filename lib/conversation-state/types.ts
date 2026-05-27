/**
 * Sistema centralizado de tipos y estados para conversaciones
 * Reemplaza los flags dispersos con un estado explícito y tipado
 */

/**
 * Todas las fases posibles de una conversación
 * Organizado por contexto (router, reagendamiento, paciente nuevo, etc)
 */
export type ConversationPhase =
  // Estado inicial
  | "idle"
  
  // Flujos de plantilla/recordatorio (asst_router)
  | "awaiting_template_response"
  | "awaiting_cancel_confirmation"
  | "awaiting_discrepancy_response"
  | "wrong_person_confirmed"
  | "awaiting_reschedule_choice"
  | "farewell_sent"
  
  // Flujos de conversación libre (asst_router)
  | "awaiting_dni"
  | "awaiting_turn_selection"
  | "awaiting_action_selection"
  | "awaiting_cancel_text_confirmation"
  
  // Flujo de reagendamiento
  | "reagendamiento_awaiting_action"
  | "reagendamiento_awaiting_turn_selection"
  | "reagendamiento_awaiting_confirmation"
  | "reagendamiento_completed"
  
  // Flujo de paciente nuevo
  | "paciente_nuevo_awaiting_name"
  | "paciente_nuevo_awaiting_dni"
  | "paciente_nuevo_awaiting_obra_social"
  | "paciente_nuevo_awaiting_sede"
  | "paciente_nuevo_awaiting_especialidad"
  | "paciente_nuevo_awaiting_profesional"
  | "paciente_nuevo_awaiting_turno_selection"
  | "paciente_nuevo_awaiting_email"
  | "paciente_nuevo_awaiting_confirmation"
  | "paciente_nuevo_completed"
  
  // Flujo de paciente existente
  | "paciente_existente_awaiting_obra_social"
  | "paciente_existente_awaiting_sede"
  | "paciente_existente_awaiting_especialidad"
  | "paciente_existente_awaiting_profesional"
  | "paciente_existente_awaiting_turno_selection"
  | "paciente_existente_awaiting_confirmation"
  | "paciente_existente_completed"

/**
 * Contexto de la conversación guardado en Redis
 * Incluye tanto los datos del usuario como el estado actual
 */
export interface ConversationContext {
  phone: string
  configId: string
  currentPhase: ConversationPhase
  
  // Datos del paciente
  paciente?: {
    nombres?: string
    apellido?: string
    dni?: string
    email?: string
    telefono?: string
    obra_social_id?: string
    obra_social_nombre?: string
  }
  
  // Datos del turno en cuestión
  turno?: {
    fecha: string
    hora: string
    profesional: string
    profesional_id?: string
    sede: string
    direccion?: string
    agenda_id?: string
    admite_reagendamiento?: boolean
    tipo?: string
  }
  
  // Contexto de flujo
  turnoIndex?: number
  selectedTurnos?: any[]
  discrepancyType?: string
  lastTemplateMessage?: string
  intentDetected?: string
  
  // Timestamps
  createdAt: string
  updatedAt: string
  phaseStartedAt?: string
}

/**
 * Feature flags por cliente
 * Controlan qué funcionalidades de respuestas directas están activas
 */
export interface FeatureFlags {
  // Confirmación/Cancelación directa
  directConfirmation: boolean
  directCancellation: boolean
  
  // Selección de turnos por número
  directTurnSelection: boolean
  
  // Extracción de DNI
  directDNIExtraction: boolean
  
  // Anti-repetición de despedidas
  antiRepetitionFarewell: boolean
  
  // Flujos completos
  directReagendamiento: boolean
  directPacienteNuevo: boolean
  directPacienteExistente: boolean
}

/**
 * Configuración por defecto de feature flags
 * Todos OFF = comportamiento actual sin cambios
 */
export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  directConfirmation: false,
  directCancellation: false,
  directTurnSelection: false,
  directDNIExtraction: false,
  antiRepetitionFarewell: false,
  directReagendamiento: false,
  directPacienteNuevo: false,
  directPacienteExistente: false,
}

/**
 * Estados que requieren respuesta del usuario
 * Se usan para validar transiciones
 */
export const AWAITING_RESPONSE_PHASES = new Set<ConversationPhase>([
  "awaiting_template_response",
  "awaiting_cancel_confirmation",
  "awaiting_discrepancy_response",
  "awaiting_dni",
  "awaiting_turn_selection",
  "awaiting_action_selection",
  "awaiting_cancel_text_confirmation",
  "awaiting_reschedule_choice",
  "reagendamiento_awaiting_action",
  "reagendamiento_awaiting_turn_selection",
  "reagendamiento_awaiting_confirmation",
  "paciente_nuevo_awaiting_name",
  "paciente_nuevo_awaiting_dni",
  "paciente_nuevo_awaiting_obra_social",
  "paciente_nuevo_awaiting_sede",
  "paciente_nuevo_awaiting_especialidad",
  "paciente_nuevo_awaiting_profesional",
  "paciente_nuevo_awaiting_turno_selection",
  "paciente_nuevo_awaiting_email",
  "paciente_nuevo_awaiting_confirmation",
  "paciente_existente_awaiting_obra_social",
  "paciente_existente_awaiting_sede",
  "paciente_existente_awaiting_especialidad",
  "paciente_existente_awaiting_profesional",
  "paciente_existente_awaiting_turno_selection",
  "paciente_existente_awaiting_confirmation",
])

/**
 * Estados terminales donde se cierra el flujo
 */
export const TERMINAL_PHASES = new Set<ConversationPhase>([
  "farewell_sent",
  "wrong_person_confirmed",
  "reagendamiento_completed",
  "paciente_nuevo_completed",
  "paciente_existente_completed",
])
