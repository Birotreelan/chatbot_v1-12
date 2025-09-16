"use client"

import { useState, useEffect } from "react"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Bot, User, Clock, Hash } from "lucide-react"
import { format } from "date-fns"
import { es } from "date-fns/locale"

interface Message {
  id: string
  phoneNumber: string
  configId: string
  clienteId: string
  message: string
  messageType: "incoming" | "outgoing"
  timestamp: string
  threadId?: string
  userName?: string
  isFromUser: boolean
}

interface ConversationMessagesProps {
  configId: string
  phoneNumber: string
  userName?: string
}

export function ConversationMessages({ configId, phoneNumber, userName }: ConversationMessagesProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchMessages()
  }, [configId, phoneNumber])

  const fetchMessages = async () => {
    try {
      setLoading(true)
      const response = await fetch(
        `/api/dashboard/conversations/messages?config_id=${configId}&phone_number=${phoneNumber}`,
      )
      const data = await response.json()

      if (data.success) {
        setMessages(data.messages || [])
      }
    } catch (error) {
      console.error("Error fetching messages:", error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-sm text-muted-foreground">Cargando mensajes...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header de la conversación */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {userName || phoneNumber}
          </CardTitle>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>{phoneNumber}</span>
            <Badge variant="outline">{messages.length} mensajes</Badge>
            {messages.length > 0 && messages[0].threadId && (
              <div className="flex items-center gap-1">
                <Hash className="h-3 w-3" />
                <span className="font-mono text-xs">{messages[0].threadId.slice(-8)}</span>
              </div>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* Lista de mensajes */}
      <div className="space-y-4">
        {messages.map((message) => (
          <div key={message.id} className={`flex gap-3 ${message.isFromUser ? "justify-start" : "justify-end"}`}>
            <div className={`flex gap-3 max-w-[80%] ${message.isFromUser ? "flex-row" : "flex-row-reverse"}`}>
              {/* Avatar */}
              <div
                className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                  message.isFromUser ? "bg-blue-100 text-blue-600" : "bg-green-100 text-green-600"
                }`}
              >
                {message.isFromUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
              </div>

              {/* Mensaje */}
              <div
                className={`rounded-lg px-4 py-2 ${
                  message.isFromUser ? "bg-blue-50 border border-blue-200" : "bg-green-50 border border-green-200"
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{message.message}</p>
                <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>
                    {format(new Date(message.timestamp), "dd/MM/yyyy HH:mm", {
                      locale: es,
                    })}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
        {messages.length === 0 && (
          <div className="text-center py-12">
            <Bot className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No hay mensajes</h3>
            <p className="text-muted-foreground">Esta conversación aún no tiene mensajes registrados.</p>
          </div>
        )}
      </div>
    </div>
  )
}
