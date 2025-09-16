"use client"

import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"
import { MessageSquare, Phone, Clock } from "lucide-react"

interface Conversation {
  phoneNumber: string
  configId: string
  clienteId: string
  userName?: string
  messageCount: number
  lastMessage: string
  lastMessageAt: string
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
      const response = await fetch(`/api/dashboard/conversations?clienteId=${clienteId}`)
      const data = await response.json()
      setConversations(data.conversations || [])
    } catch (error) {
      console.error("Error fetching conversations:", error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (conversations.length === 0) {
    return (
      <Card>
        <CardContent className="text-center py-12">
          <MessageSquare className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No hay conversaciones</h3>
          <p className="text-gray-600">Este cliente aún no tiene conversaciones registradas.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Conversaciones</h2>
        <Badge variant="secondary">{conversations.length} conversaciones</Badge>
      </div>

      <div className="grid gap-4">
        {conversations.map((conversation) => (
          <Card
            key={`${conversation.configId}-${conversation.phoneNumber}`}
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => onConversationSelect(conversation)}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2 mb-2">
                    <Phone className="h-4 w-4 text-blue-600" />
                    <span className="font-medium">{conversation.phoneNumber}</span>
                    {conversation.userName && <Badge variant="outline">{conversation.userName}</Badge>}
                  </div>

                  <p className="text-sm text-gray-600 truncate mb-2">{conversation.lastMessage}</p>

                  <div className="flex items-center space-x-4 text-xs text-gray-500">
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

                <div className="ml-4">
                  <Badge
                    variant={
                      new Date(conversation.lastMessageAt) > new Date(Date.now() - 24 * 60 * 60 * 1000)
                        ? "default"
                        : "secondary"
                    }
                  >
                    {new Date(conversation.lastMessageAt) > new Date(Date.now() - 24 * 60 * 60 * 1000)
                      ? "Activa"
                      : "Inactiva"}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
