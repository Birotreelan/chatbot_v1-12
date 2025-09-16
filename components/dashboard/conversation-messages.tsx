"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { RefreshCw, Bot, User, Clock } from "lucide-react"

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

  useEffect(() => {
    fetchMessages()
  }, [configId, phoneNumber])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  const fetchMessages = async () => {
    try {
      setLoading(true)
      const response = await fetch(
        `/api/dashboard/conversations/messages?configId=${configId}&phoneNumber=${phoneNumber}`,
      )
      const data = await response.json()

      if (data.success) {
        setMessages(data.data)
      }
    } catch (error) {
      console.error("Error fetching messages:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchMessages()
    setRefreshing(false)
  }

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleString()
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p>Cargando mensajes...</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="h-[600px] flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-lg">Mensajes</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{messages.length} mensajes</Badge>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-y-auto space-y-4">
        {messages.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No hay mensajes en esta conversación</p>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.isFromUser ? "justify-start" : "justify-end"}`}>
                <div
                  className={`max-w-[70%] rounded-lg p-3 ${
                    message.isFromUser ? "bg-muted text-foreground" : "bg-primary text-primary-foreground"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {message.isFromUser ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                    <span className="text-xs opacity-70">{message.isFromUser ? "Usuario" : "Bot"}</span>
                  </div>

                  <p className="text-sm whitespace-pre-wrap">{message.message}</p>

                  <div className="flex items-center gap-1 mt-2 text-xs opacity-70">
                    <Clock className="h-3 w-3" />
                    <span>{formatTime(message.timestamp)}</span>
                    {message.threadId && (
                      <span className="ml-2 font-mono text-xs">Thread: {message.threadId.slice(-8)}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </CardContent>
    </Card>
  )
}
