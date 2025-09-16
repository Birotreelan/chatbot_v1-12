"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatDistanceToNow, format } from "date-fns"
import { es } from "date-fns/locale"
import { MessageSquare, Bot, User, Clock, Hash } from "lucide-react"

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
        `/api/dashboard/conversations/messages?configId=${configId}&phoneNumber=${phoneNumber}`,
      )
      const data = await response.json()
      setMessages(data.messages || [])
    } catch (error) {
      console.error("Error fetching messages:", error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header de la conversación */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center space-x-2">
              <MessageSquare className="h-5 w-5" />
              <span>Conversación con {phoneNumber}</span>
              {userName && <Badge variant="outline">{userName}</Badge>}
            </CardTitle>
            <Badge variant="secondary">{messages.length} mensajes</Badge>
          </div>
        </CardHeader>
      </Card>

      {/* Lista de mensajes */}
      <Card>
        <CardContent className="p-0">
          {messages.length === 0 ? (
            <div className="text-center py-12">
              <MessageSquare className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No hay mensajes</h3>
              <p className="text-gray-600">Esta conversación no tiene mensajes registrados.</p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {messages.map((message, index) => (
                <div
                  key={message.id}
                  className={`p-4 border-b border-gray-100 last:border-b-0 ${
                    message.isFromUser ? "bg-blue-50" : "bg-gray-50"
                  }`}
                >
                  <div className="flex items-start space-x-3">
                    <div
                      className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                        message.isFromUser ? "bg-blue-600" : "bg-gray-600"
                      }`}
                    >
                      {message.isFromUser ? (
                        <User className="h-4 w-4 text-white" />
                      ) : (
                        <Bot className="h-4 w-4 text-white" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-1">
                        <span className="text-sm font-medium">{message.isFromUser ? "Usuario" : "Bot"}</span>
                        <Badge variant="outline" className="text-xs">
                          {message.messageType}
                        </Badge>
                        <div className="flex items-center space-x-1 text-xs text-gray-500">
                          <Clock className="h-3 w-3" />
                          <span>{format(new Date(message.timestamp), "dd/MM/yyyy HH:mm:ss")}</span>
                        </div>
                      </div>

                      <p className="text-sm text-gray-900 whitespace-pre-wrap">{message.message}</p>

                      {message.threadId && (
                        <div className="flex items-center space-x-1 mt-2 text-xs text-gray-500">
                          <Hash className="h-3 w-3" />
                          <span>Thread: {message.threadId}</span>
                        </div>
                      )}
                    </div>

                    <div className="text-xs text-gray-500">
                      {formatDistanceToNow(new Date(message.timestamp), {
                        addSuffix: true,
                        locale: es,
                      })}
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
