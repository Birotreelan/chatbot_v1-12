/**
 * Tipos compartidos para flujos de paciente nuevo y existente
 */

// Opciones de sede
export interface SedeOption {
  numero: number
  id: string
  nombre: string
  domicilio?: string
  localidad?: string
  provincia?: string
  telefono?: string
  email?: string
  horario?: string
}

// Opciones de profesional
export interface ProfessionalOption {
  numero: number
  id: string
  nombre: string
  especialidad?: string
}

// Opciones de especialidad
export interface SpecialtyOption {
  numero: number
  id: string
  nombre: string
}

// Opciones de turno
export interface TurnoOption {
  numero: number
  id: string  // Agenda_Id
  fecha: string
  hora: string
  profesionalId: string
  profesionalNombre: string
  especialidad?: string
  sedeId?: string
  sedeNombre?: string
  duracion?: number
}

// Obra social validada
export interface ObraSocialValidada {
  id: string
  nombre: string
  razonSocial?: string
  permiteTurnosOnline: boolean
}

// Tipo de busqueda
export type SearchType = 'medico_particular' | 'especialidad' | 'cualquier_medico'

// Fases del flujo
export type FlowPhase =
  | 'awaiting_dni'
  | 'awaiting_name'
  | 'awaiting_obra_social'
  | 'awaiting_sede'
  | 'awaiting_search_type'
  | 'awaiting_professional_name'
  | 'awaiting_professional_selection'
  | 'awaiting_specialty_selection'
  | 'awaiting_turno_selection'
  | 'awaiting_email'
  | 'awaiting_confirmation'
  | 'completed'
  | 'abandoned'
  | 'error'

// Estado compartido del flujo
export interface SharedFlowState {
  // Identificacion
  phase: FlowPhase
  patientType: 'new' | 'existing'
  patientId?: string
  patientDNI: string
  patientName?: string
  patientLastName?: string
  patientPhone: string
  patientEmail?: string

  // Obra Social
  obraSocialId?: string
  obraSocialNombre?: string
  obraSocialValidada: boolean

  // Sede
  sedeId?: string
  sedeNombre?: string
  sedesOpciones?: SedeOption[]

  // Busqueda
  searchType?: SearchType

  // Profesional (opcion 1)
  profesionalId?: string
  profesionalNombre?: string
  profesionalesOpciones?: ProfessionalOption[]

  // Especialidad (opcion 2)
  especialidadId?: string
  especialidadNombre?: string
  especialidadesOpciones?: SpecialtyOption[]

  // Turnos
  turnosOpciones?: TurnoOption[]
  turnoSeleccionado?: TurnoOption
  rangoActual: number

  // Control de flujo
  attempts: number
  createdAt: number
  lastUpdated: number

  // Flag de espera actual (solo uno activo a la vez)
  currentWaitingFlag?: string
}

// Resultado de un handler
export interface HandlerResult {
  handled: boolean
  message?: string
  nextPhase?: FlowPhase
  shouldCallOpenAI?: boolean
  openAIContext?: string
  error?: string
}

// Configuracion de rangos de busqueda de turnos
export const TURNOS_SEARCH_RANGES = [7, 14, 21, 28, 35, 42, 49, 56, 60]
export const MIN_TURNOS_TO_SHOW = 8
