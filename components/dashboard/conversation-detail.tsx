"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, User, Bot, Phone, Clock, MessageCircle } from "lucide-react"
import type { Conversation } from "@/lib/types"

interface ConversationDetailProps {
  conversationId: string
  onBack: () => void
}

export function ConversationDetail({ conversationId, onBack }: ConversationDetailProps) {
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadConversation()
  }, [conversationId])

  const loadConversation = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/dashboard/conversations/${conversationId}`)
      const data = await response.json()

      if (data.success) {
        setConversation(data.data)
      } else {
        console.error("Error cargando conversación:", data.error)
      }
    } catch (error) {
      console.error("Error cargando conversación:", error)
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString("es-AR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const formatTime = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Atrás
          </Button>
        </div>
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Cargando conversación...</p>
        </div>
      </div>
    )
  }

  if (!conversation) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Atrás
          </Button>
        </div>
        <Card>
          <CardContent className="text-center py-8">
            <MessageCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Conversación no encontrada</h3>
            <p className="text-gray-600">La conversación solicitada no existe o ha sido eliminada.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Atrás
        </Button>
      </div>

      {/* Información de la conversación */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            Conversación con {conversation.userName}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-gray-500" />
              <div>
                <p className="text-sm text-gray-600">Usuario</p>
                <p className="font-medium">{conversation.userName}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-gray-500" />
              <div>
                <p className="text-sm text-gray-600">Teléfono</p>
                <p className="font-medium">{conversation.phoneNumber}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-gray-500" />
              <div>
                <p className="text-sm text-gray-600">Mensajes</p>
                <p className="font-medium">{conversation.messageCount}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-gray-500" />
              <div>
                <p className="text-sm text-gray-600">Último mensaje</p>
                <p className="font-medium">{formatDate(conversation.lastMessageAt)}</p>
              </div>
            </div>
          </div>
          <div className="mt-4">
            <Badge variant="outline">{conversation.clienteName}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Mensajes */}
      <Card>
        <CardHeader>
          <CardTitle>Historial de mensajes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {conversation.messages.length === 0 ? (
              <div className="text-center py-8">
                <MessageCircle className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                <p className="text-gray-600">No hay mensajes en esta conversación</p>
              </div>
            ) : (
              conversation.messages.map((message) => (
                <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                      message.role === "user"
                        ? "bg-blue-500 text-white"
                        : "bg-gray-100 text-gray-900 border border-gray-200"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {message.role === "user" ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                      <span className="text-xs opacity-75">{message.role === "user" ? "Usuario" : "Asistente"}</span>
                      <span className="text-xs opacity-75">{formatTime(message.timestamp)}</span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
