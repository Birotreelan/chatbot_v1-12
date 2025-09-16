"use client"

import { useEffect, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Bot, User, MessageCircle, Clock, Hash } from "lucide-react"
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

interface Conversation {
  phoneNumber: string
  configId: string
  clienteId: string
  userName?: string
  messageCount: number
  firstMessageAt: string
  lastMessageAt: string
  lastMessage: string
}

interface ConversationMessagesProps {
  messages: Message[]
  loading: boolean
  conversation: Conversation
  formatRelativeTime: (timestamp: string) => string
}

export function ConversationMessages({
  messages,
  loading,
  conversation,
  formatRelativeTime,
}: ConversationMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll a los mensajes más recientes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-5 bg-gray-200 rounded animate-pulse w-32" />
              <div className="h-4 bg-gray-200 rounded animate-pulse w-24" />
            </div>
            <div className="h-6 bg-gray-200 rounded animate-pulse w-20" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className={cn("flex", i % 2 === 0 ? "justify-start" : "justify-end")}>
                <div
                  className={cn(
                    "max-w-xs lg:max-w-md px-4 py-2 rounded-lg space-y-2",
                    i % 2 === 0 ? "bg-gray-100" : "bg-blue-100",
                  )}
                >
                  <div className="h-4 bg-gray-200 rounded animate-pulse" />
                  <div className="h-3 bg-gray-200 rounded animate-pulse w-3/4" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (messages.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <MessageCircle className="h-5 w-5 mr-2" />
            Conversación vacía
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <div className="text-center">
            <MessageCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No hay mensajes</h3>
            <p className="text-gray-600">Esta conversación aún no tiene mensajes registrados</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Info de la conversación */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                <User className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <CardTitle>{conversation.userName || "Usuario"}</CardTitle>
                <p className="text-sm text-gray-600">{conversation.phoneNumber}</p>
              </div>
            </div>
            <div className="text-right">
              <Badge variant="secondary" className="mb-1">
                {conversation.messageCount} mensajes
              </Badge>
              <div className="flex items-center text-xs text-gray-500">
                <Clock className="h-3 w-3 mr-1" />
                {formatRelativeTime(conversation.lastMessageAt)}
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Mensajes */}
      <Card>
        <CardContent className="p-4">
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {messages.map((message, index) => (
              <div
                key={message.id}
                className={cn("flex", message.messageType === "incoming" ? "justify-start" : "justify-end")}
              >
                <div
                  className={cn(
                    "max-w-xs lg:max-w-md px-4 py-2 rounded-lg",
                    message.messageType === "incoming" ? "bg-gray-100 text-gray-900" : "bg-blue-500 text-white",
                  )}
                >
                  <div className="flex items-center mb-1">
                    {message.messageType === "incoming" ? (
                      <User className="h-3 w-3 mr-1" />
                    ) : (
                      <Bot className="h-3 w-3 mr-1" />
                    )}
                    <span className="text-xs opacity-75">{message.messageType === "incoming" ? "Usuario" : "Bot"}</span>
                  </div>

                  <p className="text-sm whitespace-pre-wrap break-words">{message.message}</p>

                  <div className="flex items-center justify-between mt-2 text-xs opacity-75">
                    <span>{formatRelativeTime(message.timestamp)}</span>
                    {message.threadId && (
                      <div className="flex items-center">
                        <Hash className="h-3 w-3 mr-1" />
                        <span className="font-mono text-xs">{message.threadId.slice(-8)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
