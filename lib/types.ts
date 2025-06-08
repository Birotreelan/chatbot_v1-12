export interface WhatsAppConfig {
  id: string
  phoneNumberId: string
  wabaId: string
  displayName: string
  assistantId: string
  active: boolean
  createdAt: string
  updatedAt: string
  verifyToken: string
  accessToken: string
  webhookUrl?: string
  cliente_id?: string // NUEVO CAMPO AGREGADO

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
  widgetTheme?: "light" | "dark"
  widgetButtonText?: string
  widgetButtonSubtext?: string // Nuevo campo para el texto que acompaña al botón
  widgetShowButtonText?: boolean // Nuevo campo para mostrar/ocultar el texto

  stats?: {
    messagesReceived: number
    messagesProcessed: number
    errors: number
    lastMessageAt?: string
  }
}
