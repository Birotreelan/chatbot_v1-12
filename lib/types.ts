export interface WhatsAppConfig {
  id: string
  phoneNumberId: string
  wabaId: string
  displayName: string
  whatsappAssistantId: string
  widgetAssistantId: string
  active: boolean
  createdAt: string
  updatedAt: string
  verifyToken: string
  accessToken: string
  webhookUrl?: string
  cliente_id?: string
  sede_id?: string
  proxy?: string

  // Widget configuration
  widgetEnabled: boolean
  widgetTitle: string
  widgetPrimaryColor: string
  widgetSecondaryColor: string
  widgetPosition: "bottom-right" | "bottom-left" | "top-right" | "top-left"
  widgetWelcomeMessage: string
  widgetPlaceholder: string
  widgetButtonText: string
  widgetHeaderText: string
  widgetSubtitle: string
  widgetBrandingEnabled: boolean
  widgetBrandingText: string
  widgetMaxHeight: number
  widgetMaxWidth: number
  widgetBorderRadius: number
  widgetShadow: boolean
  widgetAnimation: boolean
  widgetSoundEnabled: boolean
  widgetTheme: "light" | "dark"
  widgetFloatingButtonText: string
  widgetShowFloatingText: boolean

  stats: {
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
}

export interface SystemStats {
  totalConfigs: number
  activeConfigs: number
  totalMessages: number
  totalThreads: number
  lastUpdated: string
}

export interface Conversation {
  id: string
  phoneNumber: string
  userName: string
  configId: string
  clienteId: string
  clienteName: string
  threadId: string
  lastMessage: string
  lastMessageAt: string
  messageCount: number
  createdAt: string
  updatedAt: string
}

export interface ConversationMessage {
  id: string
  conversationId: string
  role: "user" | "assistant"
  content: string
  messageId?: string
  createdAt: string
}

export interface ConversationSummary {
  id: string
  phoneNumber: string
  userName: string
  clienteName: string
  lastMessage: string
  lastMessageAt: string
  messageCount: number
}
