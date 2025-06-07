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
  stats?: {
    messagesReceived: number
    messagesProcessed: number
    errors: number
    lastMessageAt?: string
  }
}
