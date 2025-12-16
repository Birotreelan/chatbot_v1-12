export interface WhatsAppConfig {
  id: string
  phoneNumberId: string
  wabaId: string
  displayName: string
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
  eventType: "template_sent" | "confirmed" | "cancelled" | "rescheduled"
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
}

export interface AdditionalAssistant {
  functionName: string // Nombre de la función, ej: "route_to_reagendamiento"
  assistantId: string // ID del asistente, ej: "asst_4cN7IH01SVAp2witTAfhU3So"
  description?: string // Descripción opcional del asistente
}
