"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ArrowLeft, RefreshCw, User, Bot, Clock, AlertCircle, MessageSquare } from "lucide-react"
import { formatDistanceToNow, format } from "date-fns"
import { es } from "date-fns/locale"

interface ConversationMessage {
  clientId: string
  clientName: string
  phoneNumberId: string
  messageId: string
  message: string
  isFromUser: boolean
  timestamp: Date
  threadId?: string
}

interface ClientConversation {
  clientId: string
  clientName: string
  phoneNumberId: string
  lastMessage: string
  lastMessageTime: Date
  messageCount: number
  threadId?: string
}

interface ConversationMessagesProps {
  client: ClientConversation
  onBack: () => void
}

export function ConversationMessages({ client, onBack }: ConversationMessagesProps) {
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchMessages = async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch(
        `/api/dashboard/conversations/messages?clientId=${encodeURIComponent(client.clientId)}`,
      )
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Error obteniendo mensajes")
      }

      if (data.success) {
        // Convertir fechas y ordenar por timestamp (más antiguos primero para mostrar cronológicamente)
        const messagesWithDates = data.data
          .map((message: any) => ({
            ...message,
            timestamp: new Date(message.timestamp),
          }))
          .sort((a: ConversationMessage, b: ConversationMessage) => a.timestamp.getTime() - b.timestamp.getTime())

        setMessages(messagesWithDates)
      } else {
        throw new Error(data.error || "Error desconocido")
      }
    } catch (error) {
      console.error("Error obteniendo mensajes:", error)
      setError(error instanceof Error ? error.message : "Error desconocido")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMessages()
  }, [client.clientId])

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-4">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <CardTitle className="flex items-center space-x-2">
                <RefreshCw className="h-5 w-5 animate-spin" />
                <span>Cargando mensajes...</span>
              </CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className={`flex ${i % 2 === 0 ? "justify-end" : "justify-start"}`}>
                <div className="max-w-xs space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                  <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-4">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <CardTitle>Error cargando mensajes</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between">
              <span>Error: {error}</span>
              <Button variant="outline" size="sm" onClick={fetchMessages} className="ml-4 bg-transparent">
                <RefreshCw className="h-4 w-4 mr-2" />
                Reintentar
              </Button>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Button variant="ghost" size="sm" onClick={onBack}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center space-x-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-xl">{client.clientName}</CardTitle>
                  <p className="text-sm text-muted-foreground">{client.clientId}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Badge variant="secondary" className="flex items-center space-x-1">
                <MessageSquare className="h-3 w-3" />
                <span>{messages.length} mensajes</span>
              </Badge>
              {client.threadId && (
                <Badge variant="outline" className="text-xs">
                  Thread: {client.threadId.substring(0, 12)}...
                </Badge>
              )}
              <Button variant="outline" size="sm" onClick={fetchMessages} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                Actualizar
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Messages */}
      <Card>
        <CardContent className="p-6">
          {messages.length === 0 ? (
            <div className="text-center py-8">
              <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No hay mensajes en esta conversación</p>
            </div>
          ) : (
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {messages.map((message) => (
                <div key={message.messageId} className={`flex ${message.isFromUser ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                      message.isFromUser ? "bg-primary text-primary-foreground" : "bg-muted"
                    }`}
                  >
                    <div className="flex items-center space-x-2 mb-1">
                      {message.isFromUser ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                      <span className="text-xs font-medium">{message.isFromUser ? client.clientName : "Bot"}</span>
                    </div>

                    <p className="text-sm whitespace-pre-wrap">{message.message}</p>

                    <div className="flex items-center space-x-1 mt-2 text-xs opacity-70">
                      <Clock className="h-3 w-3" />
                      <span>
                        {format(message.timestamp, "HH:mm")} •{" "}
                        {formatDistanceToNow(message.timestamp, {
                          addSuffix: true,
                          locale: es,
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
