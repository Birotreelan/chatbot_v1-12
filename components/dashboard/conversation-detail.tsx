"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, User, Bot, Clock, Phone, MessageCircle } from "lucide-react"
import type { Conversation, ConversationMessage } from "@/lib/types"

interface ConversationDetailProps {
  conversation: Conversation
  onBack: () => void
}

export default function ConversationDetail({ conversation, onBack }: ConversationDetailProps) {
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadMessages()
  }, [conversation.id])

  const loadMessages = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/dashboard/conversations/${encodeURIComponent(conversation.id)}`)
      if (response.ok) {
        const data = await response.json()
        setMessages(data.data || [])
      }
    } catch (error) {
      console.error("Error cargando mensajes:", error)
    } finally {
      setLoading(false)
    }
  }

  const formatTime = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <div className="flex-1">
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5" />
              Conversación con {conversation.userName}
            </CardTitle>

            <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
              <div className="flex items-center gap-1">
                <Phone className="h-3 w-3" />
                {conversation.phoneNumber}
              </div>

              <Badge variant="secondary">{conversation.clienteName}</Badge>

              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Última actividad: {formatTime(conversation.lastMessageAt)}
              </div>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-500">Cargando mensajes...</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-8">
            <MessageCircle className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">No hay mensajes en esta conversación</p>
          </div>
        ) : (
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                    message.role === "user" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-900"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {message.role === "user" ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                    <span className="text-xs opacity-75">{message.role === "user" ? "Usuario" : "Asistente"}</span>
                  </div>

                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>

                  <div className="text-xs opacity-75 mt-2">{formatTime(message.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 pt-4 border-t">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="font-medium">Total de mensajes:</span>
              <span className="ml-2">{conversation.messageCount}</span>
            </div>
            <div>
              <span className="font-medium">Conversación iniciada:</span>
              <span className="ml-2">{formatTime(conversation.createdAt)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
