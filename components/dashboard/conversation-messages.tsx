"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RefreshCw, MessageSquare, Bot, User, Clock } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"
import { cn } from "@/lib/utils"

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
}

export function ConversationMessages({ configId, phoneNumber }: ConversationMessagesProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const fetchMessages = async () => {
    try {
      setRefreshing(true)
      const response = await fetch(
        `/api/dashboard/conversations/messages?configId=${configId}&phoneNumber=${phoneNumber}`,
      )
      const data = await response.json()

      if (data.success) {
        setMessages(data.data)
        // Auto scroll to bottom after loading messages
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
        }, 100)
      } else {
        console.error("Error fetching messages:", data.error)
      }
    } catch (error) {
      console.error("Error fetching messages:", error)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchMessages()
  }, [configId, phoneNumber])

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp)
    return {
      relative: formatDistanceToNow(date, { addSuffix: true, locale: es }),
      absolute: date.toLocaleString("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <MessageSquare className="h-5 w-5 mr-2" />
            Cargando mensajes...
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-start space-x-3">
                <div className="h-8 w-8 bg-muted animate-pulse rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                  <div className="h-16 w-full bg-muted animate-pulse rounded" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="h-[600px] flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="flex items-center">
          <MessageSquare className="h-5 w-5 mr-2" />
          Conversación ({messages.length} mensajes)
        </CardTitle>
        <Button variant="outline" size="sm" onClick={fetchMessages} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <MessageSquare className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No hay mensajes</h3>
            <p className="text-muted-foreground text-center">Esta conversación aún no tiene mensajes registrados.</p>
          </div>
        ) : (
          <div className="h-full overflow-y-auto space-y-4 pr-4">
            {messages.map((message) => {
              const timestamp = formatTimestamp(message.timestamp)
              const isUser = message.messageType === "incoming"

              return (
                <div
                  key={message.id}
                  className={cn("flex items-start space-x-3", !isUser && "flex-row-reverse space-x-reverse")}
                >
                  <div
                    className={cn(
                      "flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center",
                      isUser ? "bg-blue-100 text-blue-600" : "bg-green-100 text-green-600",
                    )}
                  >
                    {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                  </div>

                  <div className={cn("flex-1 max-w-[70%]", !isUser && "flex flex-col items-end")}>
                    <div className="flex items-center space-x-2 mb-1">
                      <Badge variant={isUser ? "default" : "secondary"} className="text-xs">
                        {isUser ? "Usuario" : "Bot"}
                      </Badge>
                      <div className="flex items-center text-xs text-muted-foreground">
                        <Clock className="h-3 w-3 mr-1" />
                        <span title={timestamp.absolute}>{timestamp.relative}</span>
                      </div>
                    </div>

                    <div
                      className={cn(
                        "rounded-lg px-4 py-2 text-sm",
                        isUser
                          ? "bg-blue-50 text-blue-900 border border-blue-200"
                          : "bg-green-50 text-green-900 border border-green-200",
                      )}
                    >
                      <p className="whitespace-pre-wrap break-words">{message.message}</p>
                    </div>

                    {message.threadId && (
                      <div className="mt-1 text-xs text-muted-foreground font-mono">
                        Thread: {message.threadId.slice(-8)}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
