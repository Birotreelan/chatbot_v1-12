"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { MessageSquare, Clock, User } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"

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
  onConversationSelect: (conversation: Conversation) => void
}

export function ConversationsList({ conversations, onConversationSelect }: ConversationsListProps) {
  if (conversations.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <MessageSquare className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No hay conversaciones</h3>
          <p className="text-muted-foreground text-center">Este cliente aún no tiene conversaciones registradas.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {conversations.map((conversation) => (
        <Card
          key={`${conversation.configId}-${conversation.phoneNumber}`}
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => onConversationSelect(conversation)}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium flex items-center">
              <User className="h-4 w-4 mr-2" />
              {conversation.userName || conversation.phoneNumber}
            </CardTitle>
            <Badge variant="outline">{conversation.messageCount} mensajes</Badge>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground line-clamp-2">{conversation.lastMessage}</div>

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center">
                  <Clock className="h-3 w-3 mr-1" />
                  {formatDistanceToNow(new Date(conversation.lastMessageAt), {
                    addSuffix: true,
                    locale: es,
                  })}
                </div>
                <div className="text-xs font-mono">{conversation.phoneNumber.slice(-4)}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
