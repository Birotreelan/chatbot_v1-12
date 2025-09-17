export interface WhatsAppConfig {
  id: string
  displayName: string
  phoneNumberId: string
  accessToken: string
  verifyToken: string
  whatsappAssistantId: string
  cliente_id: string
  sede_id?: string
  wabaId?: string
  isActive: boolean
  createdAt: string
  updatedAt: string
  stats: {
    messagesReceived: number
    messagesProcessed: number
    errors: number
    lastMessageAt?: string
  }
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

export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface ErrorLog {
  id: string
  category: string
  message: string
  stack?: string
  metadata?: Record<string, any>
  createdAt: string
}

export interface MonitoringMetric {
  name: string
  value: number
  timestamp: string
  metadata?: Record<string, any>
}
