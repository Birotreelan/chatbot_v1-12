export interface WhatsAppConfig {
  id: string
  phoneNumberId: string
  wabaId?: string
  displayName: string
  assistantId: string
  active: boolean
  createdAt: string
  updatedAt: string
  verifyToken: string
  accessToken: string
  webhookUrl?: string
  lastUserPhoneNumber?: string
  cliente_id?: string
  proxy?: string
  // Configuraciones del widget
  widgetEnabled?: boolean
  widgetTitle?: string
  widgetPrimaryColor?: string
  widgetSecondaryColor?: string
  widgetPosition?: "bottom-right" | "bottom-left"
  widgetWelcomeMessage?: string
  stats?: {
    messagesReceived: number
    messagesProcessed: number
    errors: number
    lastMessageAt?: string
  }
}
