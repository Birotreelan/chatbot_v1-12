"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { MessageSquare, Clock, User } from "lucide-react"

interface Conversation {
  phoneNumber: string
  configId: string
  clienteId: string
  userName: string
  messageCount: number
  lastMessageAt: string
  lastMessage: string
}

interface ConversationsListProps {
  conversations: Conversation[]
  onConversationSelect: (conversation: Conversation) => void
}

export function ConversationsList({ conversations, onConversationSelect }: ConversationsListProps) {
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60)

    if (diffInHours < 1) {
      const diffInMinutes = Math.floor(diffInHours * 60)
      return `hace ${diffInMinutes} min`
    } else if (diffInHours < 24) {
      return `hace ${Math.floor(diffInHours)} h`
    } else {
      return date.toLocaleDateString()
    }
  }

  if (conversations.length === 0) {
    return (
      <Card>
        <CardContent className="text-center py-8">
          <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No hay conversaciones</h3>
          <p className="text-muted-foreground">Las conversaciones de este cliente aparecerán aquí</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {conversations.map((conversation) => (
        <Card
          key={`${conversation.configId}-${conversation.phoneNumber}`}
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => onConversationSelect(conversation)}
        >
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4" />
                <span>{conversation.userName || conversation.phoneNumber}</span>
              </div>
              <Badge variant="outline">{conversation.messageCount} mensajes</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground line-clamp-2">{conversation.lastMessage}</p>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  <span>{formatTime(conversation.lastMessageAt)}</span>
                </div>
                <span className="font-mono">{conversation.phoneNumber}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
