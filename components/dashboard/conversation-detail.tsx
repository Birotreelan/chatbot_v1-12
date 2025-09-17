"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Phone, MessageCircle, User, Clock } from "lucide-react"
import type { Conversation } from "@/lib/types"

interface ConversationDetailProps {
  conversationId: string
  onBack: () => void
}

export function ConversationDetail({ conversationId, onBack }: ConversationDetailProps) {
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadConversation()
  }, [conversationId])

  const loadConversation = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/dashboard/conversations/${conversationId}`)
      const data = await response.json()

      if (data.success) {
        setConversation(data.data)
      }
    } catch (error) {
      console.error("Error cargando conversación:", error)
    } finally {
      setLoading(false)
    }
  }

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-gray-500">Cargando conversación...</div>
        </CardContent>
      </Card>
    )
  }

  if (!conversation) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-gray-500">Conversación no encontrada</div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex-1">
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                {conversation.userName}
              </CardTitle>
              <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                <div className="flex items-center gap-1">
                  <Phone className="h-4 w-4" />
                  <span>{conversation.phoneNumber}</span>
                </div>
                <Badge variant="secondary">{conversation.clienteName}</Badge>
                <div className="flex items-center gap-1">
                  <MessageCircle className="h-4 w-4" />
                  <span>{conversation.messageCount} mensajes</span>
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  <span>Última actividad: {formatTime(conversation.lastMessageAt)}</span>
                </div>
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Mensajes */}
      <Card>
        <CardHeader>
          <CardTitle>Historial de Mensajes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {conversation.messages.length === 0 ? (
              <div className="text-center text-gray-500 py-8">No hay mensajes en esta conversación</div>
            ) : (
              conversation.messages.map((message) => (
                <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                      message.role === "user" ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-900"
                    }`}
                  >
                    <div className="text-sm whitespace-pre-wrap">{message.content}</div>
                    <div className={`text-xs mt-1 ${message.role === "user" ? "text-blue-100" : "text-gray-500"}`}>
                      {formatTime(message.timestamp)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
