"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { RefreshCw, Bot, User } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"
import { useToast } from "@/hooks/use-toast"

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

interface Conversation {
  phoneNumber: string
  configId: string
  clienteId: string
  userName?: string
  messageCount: number
  lastMessageAt: string
  lastMessage: string
}

interface ConversationMessagesProps {
  conversation: Conversation
}

export function ConversationMessages({ conversation }: ConversationMessagesProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const { toast } = useToast()

  const fetchMessages = async () => {
    try {
      setRefreshing(true)
      const response = await fetch(
        `/api/dashboard/conversations/messages?configId=${conversation.configId}&phoneNumber=${conversation.phoneNumber}`,
      )
      const data = await response.json()

      if (data.success) {
        setMessages(data.messages)
      } else {
        throw new Error(data.error || "Error obteniendo mensajes")
      }
    } catch (error) {
      console.error("Error fetching messages:", error)
      toast({
        title: "Error",
        description: "No se pudieron cargar los mensajes",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchMessages()
  }, [conversation])

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cargando mensajes...</CardTitle>
          <CardDescription>Obteniendo el historial de la conversación</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="flex space-x-3">
                  <div className="h-8 w-8 bg-muted rounded-full"></div>
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted rounded w-1/4"></div>
                    <div className="h-3 bg-muted rounded w-3/4"></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center space-x-2">
                <User className="h-5 w-5" />
                <span>{conversation.userName || conversation.phoneNumber}</span>
              </CardTitle>
              <CardDescription>
                {conversation.userName && `${conversation.phoneNumber} • `}
                {messages.length} mensajes en total
              </CardDescription>
            </div>

            <Button variant="outline" size="sm" onClick={fetchMessages} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
              Actualizar
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          {messages.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No hay mensajes en esta conversación</p>
            </div>
          ) : (
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex space-x-3 ${message.isFromUser ? "justify-start" : "justify-end"}`}
                >
                  {message.isFromUser && (
                    <div className="flex-shrink-0">
                      <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
                        <User className="h-4 w-4 text-blue-600" />
                      </div>
                    </div>
                  )}

                  <div className={`flex-1 max-w-xs lg:max-w-md ${message.isFromUser ? "" : "flex justify-end"}`}>
                    <div
                      className={`rounded-lg px-3 py-2 ${
                        message.isFromUser ? "bg-muted text-foreground" : "bg-primary text-primary-foreground"
                      }`}
                    >
                      <p className="text-sm">{message.message}</p>

                      <div className="flex items-center justify-between mt-1 text-xs opacity-70">
                        <span>
                          {formatDistanceToNow(new Date(message.timestamp), {
                            addSuffix: true,
                            locale: es,
                          })}
                        </span>

                        {message.threadId && (
                          <Badge variant="outline" className="text-xs">
                            Thread: {message.threadId.slice(-6)}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {!message.isFromUser && (
                    <div className="flex-shrink-0">
                      <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center">
                        <Bot className="h-4 w-4 text-green-600" />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
