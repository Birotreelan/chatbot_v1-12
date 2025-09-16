"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MessageSquare, Clock, User, Phone } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"

interface ClientConversation {
  clientId: string
  clientName: string
  phoneNumberId: string
  lastMessage: string
  lastMessageTime: Date
  messageCount: number
  threadId?: string
}

interface ConversationsListProps {
  clients: ClientConversation[]
  onClientSelect: (client: ClientConversation) => void
}

export function ConversationsList({ clients, onClientSelect }: ConversationsListProps) {
  const truncateMessage = (message: string, maxLength = 100) => {
    if (message.length <= maxLength) return message
    return message.substring(0, maxLength) + "..."
  }

  return (
    <div className="grid gap-4">
      {clients.map((client) => (
        <Card key={client.clientId} className="hover:shadow-md transition-shadow">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">{client.clientName}</CardTitle>
                  <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                    <Phone className="h-3 w-3" />
                    <span>{client.clientId}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Badge variant="secondary" className="flex items-center space-x-1">
                  <MessageSquare className="h-3 w-3" />
                  <span>{client.messageCount}</span>
                </Badge>
                {client.threadId && (
                  <Badge variant="outline" className="text-xs">
                    Thread: {client.threadId.substring(0, 8)}...
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-3">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Último mensaje:</p>
                <p className="text-sm">{truncateMessage(client.lastMessage)}</p>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>
                    {formatDistanceToNow(client.lastMessageTime, {
                      addSuffix: true,
                      locale: es,
                    })}
                  </span>
                </div>

                <Button size="sm" onClick={() => onClientSelect(client)} className="flex items-center space-x-1">
                  <MessageSquare className="h-3 w-3" />
                  <span>Ver conversación</span>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
