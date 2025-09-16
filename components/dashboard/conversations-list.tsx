"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { MessageCircle, User, Clock } from "lucide-react"

interface Conversation {
  phoneNumber: string
  configId: string
  clienteId: string
  userName?: string
  messageCount: number
  firstMessageAt: string
  lastMessageAt: string
  lastMessage: string
}

interface ConversationsListProps {
  conversations: Conversation[]
  loading: boolean
  onConversationSelect: (conversation: Conversation) => void
  formatRelativeTime: (timestamp: string) => string
}

export function ConversationsList({
  conversations,
  loading,
  onConversationSelect,
  formatRelativeTime,
}: ConversationsListProps) {
  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <div className="h-4 bg-gray-200 rounded animate-pulse w-32" />
                  <div className="h-3 bg-gray-200 rounded animate-pulse w-24" />
                </div>
                <div className="h-6 bg-gray-200 rounded animate-pulse w-16" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-3 bg-gray-200 rounded animate-pulse w-full mb-2" />
              <div className="h-3 bg-gray-200 rounded animate-pulse w-3/4" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (conversations.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <div className="text-center">
            <MessageCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No hay conversaciones</h3>
            <p className="text-gray-600">Este cliente aún no tiene conversaciones registradas</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {conversations.map((conversation) => (
        <Card
          key={`${conversation.configId}-${conversation.phoneNumber}`}
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => onConversationSelect(conversation)}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <User className="h-5 w-5 text-blue-600" />
                  </div>
                </div>
                <div>
                  <CardTitle className="text-base">{conversation.userName || "Usuario"}</CardTitle>
                  <p className="text-sm text-gray-600">{conversation.phoneNumber}</p>
                </div>
              </div>
              <div className="text-right">
                <Badge variant="secondary" className="mb-1">
                  {conversation.messageCount} mensajes
                </Badge>
                <div className="flex items-center text-xs text-gray-500">
                  <Clock className="h-3 w-3 mr-1" />
                  {formatRelativeTime(conversation.lastMessageAt)}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-700 line-clamp-2">{conversation.lastMessage}</p>
            <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
              <span>Iniciado: {new Date(conversation.firstMessageAt).toLocaleDateString()}</span>
              <span>Último: {formatRelativeTime(conversation.lastMessageAt)}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
