"use client"

import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MessageSquare, RefreshCw, User, Bot } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"

interface Message {
  id: string
  phoneNumber: string
  configId: string
  clienteId: string
  message: string
  direction: "incoming" | "outgoing"
  threadId?: string
  userName?: string
  timestamp: string
}

interface ConversationMessagesProps {
  phoneNumber: string
  configId: string
}

export function ConversationMessages({ phoneNumber, configId }: ConversationMessagesProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadMessages()
  }, [phoneNumber, configId])

  const loadMessages = async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch(
        `/api/dashboard/conversations/messages?phoneNumber=${encodeURIComponent(phoneNumber)}&configId=${encodeURIComponent(configId)}`,
      )
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Error cargando mensajes")
      }

      if (data.success) {
        setMessages(data.messages || [])
      } else {
        throw new Error(data.error || "Error en la respuesta")
      }
    } catch (err) {
      console.error("Error cargando mensajes:", err)
      setError(err instanceof Error ? err.message : "Error desconocido")
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-600 mb-4">{error}</p>
        <Button onClick={loadMessages} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Reintentar
        </Button>
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No hay mensajes en esta conversación</p>
      </div>
    )
  }

  return (
    <div className="space-y-4 max-h-96 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          {messages.length} mensaje{messages.length !== 1 ? "s" : ""}
        </p>
        <Button onClick={loadMessages} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Actualizar
        </Button>
      </div>

      {messages.map((message) => (
        <Card
          key={message.id}
          className={`${
            message.direction === "incoming"
              ? "bg-muted/50 border-l-4 border-l-blue-500"
              : "bg-green-50 border-l-4 border-l-green-500"
          }`}
        >
          <CardContent className="p-4">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                {message.direction === "incoming" ? (
                  <User className="h-4 w-4 text-blue-600" />
                ) : (
                  <Bot className="h-4 w-4 text-green-600" />
                )}
                <span className="font-medium text-sm">
                  {message.direction === "incoming" ? message.userName || "Usuario" : "Bot"}
                </span>
                <Badge variant={message.direction === "incoming" ? "default" : "secondary"} className="text-xs">
                  {message.direction === "incoming" ? "Entrante" : "Saliente"}
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(message.timestamp), {
                  addSuffix: true,
                  locale: es,
                })}
              </span>
            </div>
            <p className="text-sm whitespace-pre-wrap">{message.message}</p>
            {message.threadId && <p className="text-xs text-muted-foreground mt-2">Thread: {message.threadId}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
