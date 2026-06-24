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
  
  // Flujo de detección inicial (sin recordatorio)
  | "initial_detection_pending"
  | "initial_detection_existing_shown"
  | "initial_detection_new_shown"
  | "initial_detection_awaiting_action"

  // Flujo de paciente existente (new Sprint 9b)
  | "existing_patient_initial"
  | "existing_patient_awaiting_email"
  | "existing_patient_awaiting_sede"
  | "existing_patient_awaiting_search_type"
  | "existing_patient_awaiting_professional"
  | "existing_patient_awaiting_specialty"
  | "existing_patient_awaiting_turns"
  | "existing_patient_awaiting_turn_selection"
  | "existing_patient_awaiting_confirmation"
  | "existing_patient_completed"

  // Flujo de paciente nuevo (new Sprint 9c)
  | "new_patient_initial"
  | "new_patient_awaiting_name"
  | "new_patient_awaiting_health_insurance"
  | "new_patient_awaiting_venue"
  | "new_patient_awaiting_search_type"
  | "new_patient_awaiting_professional"
  | "new_patient_awaiting_specialty"
  | "new_patient_awaiting_turns"
  | "new_patient_awaiting_turn_selection"
  | "new_patient_awaiting_email"
  | "new_patient_awaiting_confirmation"
  | "new_patient_completed"

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

  // Flujo de reserva unificado (Sprint 6-8)
  // Resuelve selecciones numéricas en obra social, sede, profesional, especialidad y turno
  directBookingFlow: boolean

  // Extractor de selecciones inteligente (Sprint 7)
  // Multi-capa: números, letras, ordinales, posicionales, coincidencias de texto, fuzzy matching
  directSelectionExtraction: boolean

  // Detección inicial de paciente (Sprint 9a)
  // Detecta paciente por teléfono y muestra saludo + turnos cuando no hay recordatorio
  directPatientDetection: boolean

  // Flujo paciente existente (Sprint 9b)
  // Maneja reserva completa de turnos para pacientes ya registrados
  directExistingPatientFlow: boolean

  // NLU Contextual para flujos pendientes (Sprint 10)
  // Detecta intención cuando usuario responde con texto libre en medio de un flujo
  // y genera respuestas que reconocen la intención pero mantienen el flujo actual
  pendingFlowContextualNLU: boolean

  // Detección de despedida pre-flujo (Sprint 12)
  // Detecta "gracias", "chau", etc. ANTES de iniciar detección de paciente
  // Evita mostrar menú de bienvenida cuando el usuario solo se despide
  directFarewellDetection: boolean

  // Detección de número equivocado (Sprint 13)
  // Detecta "se equivocaron de número", "no soy esa persona", etc.
  // ANTES de iniciar detección de paciente, para evitar tratar al usuario
  // como el paciente del recordatorio cuando no lo es
  directWrongNumberDetection: boolean

  // Detección de confirmación/cancelación directa (Sprint 14)
  // Detecta "Confirmo", "Cancelo", "Voy", "No puedo", etc. por texto libre
  // cuando hay un template reciente (ventana 24h) pero sin flowState pendiente
  // Procesa la acción directamente sin pasar por detección de paciente
  directConfirmCancelDetection: boolean

  // Detección de respuesta recíproca a despedida (Sprint 15)
  // Detecta "Igualmente", "Vos también", "Para ti también", etc.
  // cuando el bot envió una despedida recientemente
  // En estos casos NO respondemos nada (silencio)
  reciprocalFarewellSilence: boolean

  // Detección de consultas informativas (Sprint 16)
  // Detecta "¿Cuál es la dirección?", "¿A qué hora es?", "¿Con quién es el turno?", etc.
  // cuando hay un turno en contexto (appointmentData)
  // Responde directamente con la información solicitada sin reiniciar el flujo
  directInformationalQuery: boolean

  // Manejo de contexto post-acción (Sprint 17)
  // Detecta mensajes contextuales después de confirmación/cancelación
  // Ej: "Está con neumonía" (explicación de por qué canceló)
  // Responde empáticamente sin reiniciar el flujo de bienvenida
  postActionContextHandler: boolean

  // NLU Fallback Router (Sprint 18)
  // Cuando ningún handler específico (regex puro) detecta intención con alta confianza,
  // este handler NLU actúa como "fallback inteligente" para clasificar la intención real
  // Resuelve false positives (ej: "Si estaré ede dia" detectado como consulta de fecha)
  // y redirige al flujo correcto (confirmación, cancelación, queja, etc.)
  nluFallbackRouter: boolean

  // Interceptor de Consultas Intercaladas en Flujos Activos (Sprint 44)
  // Cuando el usuario envía texto libre mientras se espera una selección numérica
  // (sede, especialidad, profesional, turno), detecta si es una consulta intercalada
  // y responde sin perder el estado del flujo actual, re-mostrando las opciones al final.
  // Si el feature está OFF, el comportamiento original (mensaje de error) se mantiene.
  flowInterruptionHandler: boolean
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
  directBookingFlow: false,
  directSelectionExtraction: false,
  directPatientDetection: false,
  directExistingPatientFlow: false,
  pendingFlowContextualNLU: false,
  directFarewellDetection: false,
  directWrongNumberDetection: false,
  directConfirmCancelDetection: false,
  reciprocalFarewellSilence: false,
  directInformationalQuery: false,
  postActionContextHandler: false,
  nluFallbackRouter: false,
  flowInterruptionHandler: false,
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
