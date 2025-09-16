"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { MessageSquare, Bot, User } from "lucide-react"
import { cn } from "@/lib/utils"

interface ConversationMessage {
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
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchMessages()
  }, [configId, phoneNumber])

  async function fetchMessages() {
    try {
      const response = await fetch(
        `/api/dashboard/conversations/messages?config_id=${configId}&phone_number=${phoneNumber}`,
      )
      if (response.ok) {
        const data = await response.json()
        setMessages(data.messages || [])
      }
    } catch (error) {
      console.error("Error al cargar mensajes:", error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="p-4 border rounded-md">Cargando mensajes...</div>
  }

  if (messages.length === 0) {
    return (
      <Card>
        <CardContent className="text-center py-8">
          <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">No hay mensajes</h3>
          <p className="text-muted-foreground">Esta conversación no tiene mensajes registrados.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4 max-h-[600px] overflow-y-auto">
      {messages.reverse().map((message) => (
        <div key={message.id} className={cn("flex gap-3", message.isFromUser ? "justify-start" : "justify-end")}>
          <div className={cn("flex gap-3 max-w-[80%]", message.isFromUser ? "flex-row" : "flex-row-reverse")}>
            <div className="flex-shrink-0">
              {message.isFromUser ? (
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                  <User className="h-4 w-4 text-blue-600" />
                </div>
              ) : (
                <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                  <Bot className="h-4 w-4 text-green-600" />
                </div>
              )}
            </div>

            <div className="flex-1">
              <Card className={cn(message.isFromUser ? "bg-blue-50 border-blue-200" : "bg-green-50 border-green-200")}>
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant={message.isFromUser ? "default" : "secondary"} className="text-xs">
                      {message.isFromUser ? "Usuario" : "Bot"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(message.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{message.message}</p>
                  {message.threadId && <p className="text-xs text-muted-foreground mt-2">Thread: {message.threadId}</p>}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
