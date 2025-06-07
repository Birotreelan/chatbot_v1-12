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
  // Configuraciones del widget web
  widgetEnabled?: boolean
  widgetTitle?: string
  widgetPrimaryColor?: string
  widgetSecondaryColor?: string
  widgetPosition?: "bottom-right" | "bottom-left"
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
  stats?: {
    messagesReceived: number
    messagesProcessed: number
    errors: number
    lastMessageAt?: string
    webChatsStarted?: number
    webMessagesReceived?: number
  }
}
