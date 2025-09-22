"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ArrowLeft, User, Bot, Phone, Calendar } from "lucide-react"

interface ConversationMessage {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: string
}

interface Conversation {
  id: string
  phoneNumber: string
  userName: string
  clienteName: string
  threadId: string
  createdAt: string
  messages: ConversationMessage[]
}

interface ConversationDetailProps {
  conversationId: string
  onBack: () => void
}

export function ConversationDetail({ conversationId, onBack }: ConversationDetailProps) {
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchConversation()
  }, [conversationId])

  const fetchConversation = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/dashboard/conversations/${encodeURIComponent(conversationId)}`)
      const data = await response.json()

      if (data.success) {
        setConversation(data.conversation)
      }
    } catch (error) {
      console.error("Error fetching conversation:", error)
    } finally {
      setLoading(false)
    }
  }

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  if (loading) {
    return (
      <Card className="h-full">
        <CardContent className="flex items-center justify-center h-full">
          <div className="text-center text-gray-500">Cargando conversación...</div>
        </CardContent>
      </Card>
    )
  }

  if (!conversation) {
    return (
      <Card className="h-full">
        <CardContent className="flex items-center justify-center h-full">
          <div className="text-center text-gray-500">Conversación no encontrada</div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="border-b">
        <div className="flex items-center gap-3">
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
                {conversation.phoneNumber}
              </div>
              <div className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                {formatTimestamp(conversation.createdAt)}
              </div>
              <Badge variant="outline">{conversation.clienteName}</Badge>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-y-auto p-4">
        <div className="space-y-4">
          {conversation.messages.length === 0 ? (
            <div className="text-center text-gray-500 py-8">No hay mensajes en esta conversación</div>
          ) : (
            conversation.messages.map((message) => (
              <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[70%] rounded-lg p-3 ${
                    message.role === "user"
                      ? "bg-blue-500 text-white"
                      : "bg-gray-100 text-gray-900 border border-gray-200"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {message.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                    <span className="text-xs opacity-75">{message.role === "user" ? "Usuario" : "Asistente"}</span>
                  </div>
                  <div className="whitespace-pre-wrap">{message.content}</div>
                  <div className="text-xs opacity-75 mt-2">{formatTimestamp(message.timestamp)}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}
