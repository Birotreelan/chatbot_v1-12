export interface WhatsAppConfig {
  id: string
  phoneNumberId: string
  whatsappNumber?: string
  wabaId: string
  displayName: string
  alias?: string
  whatsappAssistantId: string
  widgetAssistantId: string
  active: boolean
  paused?: boolean
  createdAt: string
  updatedAt: string
  verifyToken: string
  accessToken: string
  webhookUrl?: string
  cliente_id?: string
  proxy?: string
  escalationPhoneNumber?: string

  healthStatus?: "AVAILABLE" | "LIMITED" | "BLOCKED"
  lastHealthCheck?: string
  healthCheckError?: string

  additionalAssistants?: AdditionalAssistant[]

  businessHours?: DaySchedule[]
  whatsappSupportHours?: DaySchedule[]
  timezone?: string

  // Widget configuration
  widgetEnabled?: boolean
  widgetTitle?: string
  widgetPrimaryColor?: string
  widgetSecondaryColor?: string
  widgetPosition?: "bottom-right" | "bottom-left" | "top-right" | "top-left"
  widgetWelcomeMessage?: string
  widgetPlaceholder?: string
  widgetButtonText?: string
  widgetHeaderText?: string
  widgetSubtitle?: string
  widgetBrandingEnabled?: boolean
  widgetBrandingText?: string
  widgetMaxHeight?: number
  widgetMaxWidth?: number
  widgetBorderRadius?: number
  widgetShadow?: boolean
  widgetAnimation?: boolean
  widgetSoundEnabled?: boolean
  widgetTheme?: "light" | "dark" | "auto"

  // Nuevos campos para el botón flotante
  widgetFloatingButtonText?: string
  widgetShowFloatingText?: boolean

  stats?: {
    messagesReceived: number
    messagesProcessed: number
    errors: number
    lastMessageAt?: string
  }
}

export interface ThreadInfo {
  threadId: string
  phoneNumber: string
  whatsappConfigId: string
  lastMessageAt: string
  messageCount: number
  isResetThread?: boolean
  createdAt?: string
  assistantId?: string
}

export interface SystemStats {
  totalConfigs: number
  activeConfigs: number
  totalMessages: number
  totalThreads: number
  lastUpdated: string
}

export interface AppointmentStats {
  // Totales
  totalConfirmed: number
  totalCancelled: number
  totalRescheduled: number
  totalTemplatesSent: number

  // Por día (últimos 30 días)
  confirmedByDay: Record<string, number>
  cancelledByDay: Record<string, number>
  rescheduledByDay: Record<string, number>
  templatesSentByDay: Record<string, number>

  // Tasas de conversión
  confirmationRate: number // (confirmados / plantillas enviadas) * 100
  cancellationRate: number // (cancelados / plantillas enviadas) * 100
  responseRate: number // ((confirmados + cancelados) / plantillas enviadas) * 100

  // Tiempos promedio (en minutos)
  avgResponseTime: number // Tiempo promedio de respuesta
  avgConfirmationTime: number // Tiempo promedio hasta confirmación
  avgCancellationTime: number // Tiempo promedio hasta cancelación

  // Última actualización
  lastUpdated: string
}

export interface AppointmentEvent {
  id: string
  clienteId: string
  phoneNumber: string
  eventType: "template_sent" | "confirmed" | "cancelled" | "rescheduled" | "user_initiated" | "new_appointment" | "reschedule_started"
  timestamp: string
  templateSentAt?: string // Para calcular tiempo de respuesta
  appointmentInfo?: {
    fecha?: string
    hora?: string
    profesional?: string
    especialidad?: string
    lugar?: string
  }
  metadata?: Record<string, any>
}

export interface ClientAppointmentStats extends AppointmentStats {
  clienteId: string
  clientName: string
  // Desglose adicional por especialidad, profesional, etc.
  bySpecialty?: Record<string, number>
  byProfessional?: Record<string, number>
  byTimeOfDay?: {
    morning: number // 6am - 12pm
    afternoon: number // 12pm - 6pm
    evening: number // 6pm - 10pm
  }
  byDayOfWeek?: Record<string, number>
  
  // Métricas de conversaciones iniciadas por el usuario (user-initiated)
  totalUserInitiated: number // Total de conversaciones sin template o fuera de ventana 24h
  userInitiatedByDay: Record<string, number> // Conversaciones user-initiated por día
  userInitiatedRate: number // % de conversaciones que son user-initiated
  
  // Métricas de turnos nuevos vs reagendamientos
  totalNewAppointments: number // Total de turnos nuevos (sin cancelación previa en 12hs)
  newAppointmentsByDay: Record<string, number> // Turnos nuevos por día
  
  // Métricas de inicio de proceso de reagendamiento
  totalRescheduleStarted: number // Total de veces que se inició el proceso de reagendamiento
  rescheduleStartedByDay: Record<string, number> // Inicios de reagendamiento por día
  rescheduleConversionRate: number // % de reagendamientos completados vs iniciados
}

export interface AdditionalAssistant {
  functionName: string // Nombre de la función, ej: "route_to_reagendamiento"
  assistantId: string // ID del asistente, ej: "asst_4cN7IH01SVAp2witTAfhU3So"
  description?: string // Descripción opcional del asistente
}

export interface SupportUser {
  id: string
  username: string
  passwordHash: string // bcrypt hash
  role: "super_admin" | "support_agent"
  tenantId: string | null // null = super_admin (ve todo), string = solo ese cliente
  displayName: string
  email?: string
  active: boolean
  createdAt: string
  updatedAt?: string
}

export interface SessionData {
  userId: string
  username: string
  role: "super_admin" | "support_agent"
  tenantId: string | null
  displayName: string
}

export interface HumanSupportSession {
  id: string // sessionId único
  phoneNumber: string
  configId: string
  tenantId: string // cliente_id para filtrar por cliente
  status: "pending" | "in_progress" | "resolved"
  priority: "low" | "medium" | "high"
  reason: string // Razón del escalamiento
  summary: string // Resumen del contexto
  threadId: string
  assistantId: string

  // Metadatos de asignación
  requestedAt: string
  assignedTo: string | null // userId del agente
  assignedAt: string | null
  resolvedAt: string | null

  // Datos del cliente
  displayName: string // Nombre de la configuración/cliente

  // Mensajes pendientes mientras espera asignación
  pendingMessages: ConversationMessage[]
}

export interface HumanSupportMessage {
  id: string
  sessionId: string
  role: "user" | "agent" | "system" | "assistant" // Agregado "assistant" para mensajes de IA
  content: string
  timestamp: string
  agentId?: string
  phoneNumber?: string
}

export interface ConversationAnalytics {
  start: number // UNIX timestamp
  end: number // UNIX timestamp
  conversation: number // Cantidad de conversaciones
  phone_number?: string
  country?: string
  conversation_type?: "REGULAR" | "FREE_TIER" | "FREE_ENTRY_POINT"
  conversation_category?: "AUTHENTICATION" | "MARKETING" | "SERVICE" | "UTILITY"
  conversation_direction?: "BUSINESS_INITIATED" | "USER_INITIATED"
  cost?: number // Costo en USD (solo disponible si no se factura a través de BSP)
}

export interface ConversationAnalyticsResponse {
  conversation_analytics?: {
    data: Array<{
      data_points: ConversationAnalytics[]
    }>
  }
}

export interface ConsumptionSummary {
  totalConversations: number
  totalCost: number
  messagesSent: number
  messagesDelivered: number
  byCategory: {
    authentication: { count: number; cost: number }
    marketing: { count: number; cost: number }
    service: { count: number; cost: number }
    utility: { count: number; cost: number }
  }
  byCountry: Record<string, { count: number; cost: number }>
  periodStart: string
  periodEnd: string
  currency: string
}

export interface ConversationMessage {
  id: string
  content: string
  timestamp: string
  from: "user" | "assistant"
}

export interface DaySchedule {
  dayOfWeek: number // 0 = Domingo, 1 = Lunes, ... 6 = Sábado
  enabled: boolean
  periods: TimePeriod[]
}

export interface TimePeriod {
  startTime: string // Formato "HH:MM"
  endTime: string // Formato "HH:MM"
}

// Plantillas Globales de WhatsApp
export interface GlobalTemplateVariable {
  index: number
  example: string
}

export interface GlobalTemplateButton {
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER" | "COPY_CODE" | "FLOW"
  text: string
  url?: string
  phoneNumber?: string
  example?: string[]
  flowId?: string
  flowAction?: string
}

export interface GlobalTemplateComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS"
  format?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT"
  text?: string
  buttons?: GlobalTemplateButton[]
  example?: {
    header_text?: string[]
    body_text?: string[][]
    header_handle?: string[]
  }
}

export interface GlobalTemplate {
  id: string
  name: string
  displayName: string // Nombre amigable para mostrar en el dashboard
  description?: string // Descripcion opcional
  language: string
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION"
  components: GlobalTemplateComponent[]
  createdAt: string
  updatedAt: string
  createdBy?: string // ID del usuario que la creo
  sourceConfigId?: string // ID de la config de donde se extrajo (si aplica)
}
