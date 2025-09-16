"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { MessageSquare, Clock, User } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"

interface Conversation {
  id: string
  phoneNumber: string
  configId: string
  userName: string
  lastMessage: string
  lastMessageTime: string
  messageCount: number
}

interface ConversationsListProps {
  conversations: Conversation[]
  onConversationSelect: (conversation: Conversation) => void
}

export function ConversationsList({ conversations, onConversationSelect }: ConversationsListProps) {
  if (conversations.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No hay conversaciones disponibles para este cliente</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {conversations.map((conversation) => (
        <Card
          key={conversation.id}
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => onConversationSelect(conversation)}
        >
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">{conversation.userName}</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {conversation.messageCount} mensaje{conversation.messageCount !== 1 ? "s" : ""}
                </Badge>
              </div>
            </div>
            <CardDescription className="flex items-center gap-1">
              <span>{conversation.phoneNumber}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground line-clamp-2">{conversation.lastMessage}</p>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>
                  {formatDistanceToNow(new Date(conversation.lastMessageTime), {
                    addSuffix: true,
                    locale: es,
                  })}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
