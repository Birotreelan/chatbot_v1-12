"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
  lastMessageAt: string
  lastMessage: string
}

interface ConversationsListProps {
  conversations: Conversation[]
  loading: boolean
  onConversationSelect: (conversation: Conversation) => void
}

export function ConversationsList({ conversations, loading, onConversationSelect }: ConversationsListProps) {
  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="animate-pulse space-y-3">
                <div className="h-4 bg-muted rounded w-1/3"></div>
                <div className="h-3 bg-muted rounded w-3/4"></div>
                <div className="h-3 bg-muted rounded w-1/2"></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (conversations.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No hay conversaciones</CardTitle>
          <CardDescription>Este cliente aún no tiene conversaciones registradas</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Las conversaciones aparecerán aquí cuando los usuarios interactúen con el chatbot.
          </p>
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
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1 space-y-2">
                <div className="flex items-center space-x-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{conversation.userName || conversation.phoneNumber}</span>
                  {conversation.userName && (
                    <span className="text-sm text-muted-foreground">({conversation.phoneNumber})</span>
                  )}
                </div>

                <p className="text-sm text-muted-foreground line-clamp-2">{conversation.lastMessage}</p>

                <div className="flex items-center space-x-4 text-xs text-muted-foreground">
                  <div className="flex items-center space-x-1">
                    <MessageSquare className="h-3 w-3" />
                    <span>{conversation.messageCount} mensajes</span>
                  </div>

                  <div className="flex items-center space-x-1">
                    <Clock className="h-3 w-3" />
                    <span>
                      {formatDistanceToNow(new Date(conversation.lastMessageAt), {
                        addSuffix: true,
                        locale: es,
                      })}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-end space-y-2">
                <Badge variant="secondary">{conversation.messageCount}</Badge>

                {/* Indicador de actividad reciente */}
                {new Date(conversation.lastMessageAt) > new Date(Date.now() - 24 * 60 * 60 * 1000) && (
                  <Badge variant="default" className="text-xs">
                    Activa
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
