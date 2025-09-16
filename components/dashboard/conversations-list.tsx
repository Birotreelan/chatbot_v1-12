"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MessageSquare, Phone, Clock } from "lucide-react"
import { ConversationMessages } from "./conversation-messages"

interface ConversationSummary {
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
}

export function ConversationsList({ clienteId }: ConversationsListProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [selectedConversation, setSelectedConversation] = useState<ConversationSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchConversations()
  }, [clienteId])

  async function fetchConversations() {
    try {
      const response = await fetch(`/api/dashboard/conversations?cliente_id=${clienteId}`)
      if (response.ok) {
        const data = await response.json()
        setConversations(data.conversations || [])
      }
    } catch (error) {
      console.error("Error al cargar conversaciones:", error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="p-4 border rounded-md">Cargando conversaciones...</div>
  }

  if (selectedConversation) {
    return (
      <div>
        <div className="flex items-center gap-4 mb-6">
          <Button variant="outline" onClick={() => setSelectedConversation(null)}>
            ← Volver a conversaciones
          </Button>
          <div>
            <h3 className="text-xl font-bold">{selectedConversation.userName || selectedConversation.phoneNumber}</h3>
            <p className="text-muted-foreground">
              {selectedConversation.phoneNumber} • {selectedConversation.messageCount} mensajes
            </p>
          </div>
        </div>

        <ConversationMessages configId={selectedConversation.configId} phoneNumber={selectedConversation.phoneNumber} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {conversations.length > 0 ? (
        conversations.map((conversation) => (
          <Card
            key={`${conversation.configId}-${conversation.phoneNumber}`}
            className="cursor-pointer hover:shadow-md transition-shadow"
          >
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Phone className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <CardTitle className="text-base">{conversation.userName || conversation.phoneNumber}</CardTitle>
                    {conversation.userName && (
                      <p className="text-sm text-muted-foreground">{conversation.phoneNumber}</p>
                    )}
                  </div>
                </div>
                <Badge variant="outline">{conversation.messageCount} mensajes</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground line-clamp-2">{conversation.lastMessage}</p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {new Date(conversation.lastMessageAt).toLocaleString()}
                  </div>
                  <Button size="sm" onClick={() => setSelectedConversation(conversation)}>
                    Ver Mensajes
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))
      ) : (
        <Card>
          <CardContent className="text-center py-8">
            <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No hay conversaciones</h3>
            <p className="text-muted-foreground">Este cliente aún no tiene conversaciones registradas.</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
