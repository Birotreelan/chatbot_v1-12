"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { MessageSquare, Clock, User } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"

interface Conversation {
  phoneNumber: string
  userName?: string
  lastMessage: string
  lastMessageAt: string
  messageCount: number
  configId: string
  clienteId: string
}

interface ConversationsListProps {
  clienteId: string
  onConversationSelect: (conversation: Conversation) => void
}

export function ConversationsList({ clienteId, onConversationSelect }: ConversationsListProps) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchConversations()
  }, [clienteId])

  const fetchConversations = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/dashboard/conversations?cliente_id=${clienteId}`)
      const data = await response.json()

      if (data.success) {
        setConversations(data.conversations)
      }
    } catch (error) {
      console.error("Error fetching conversations:", error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-sm text-muted-foreground">Cargando conversaciones...</p>
        </div>
      </div>
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
              <CardTitle className="text-base flex items-center gap-2">
                <User className="h-4 w-4" />
                {conversation.userName || conversation.phoneNumber}
              </CardTitle>
              <Badge variant="secondary">{conversation.messageCount} mensajes</Badge>
            </div>
            {conversation.userName && <CardDescription className="text-xs">{conversation.phoneNumber}</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-2">
              <MessageSquare className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <p className="text-sm text-muted-foreground line-clamp-2">{conversation.lastMessage}</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>
                {formatDistanceToNow(new Date(conversation.lastMessageAt), {
                  addSuffix: true,
                  locale: es,
                })}
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
      {conversations.length === 0 && (
        <div className="text-center py-12">
          <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No hay conversaciones</h3>
          <p className="text-muted-foreground">Este cliente aún no tiene conversaciones registradas.</p>
        </div>
      )}
    </div>
  )
}
