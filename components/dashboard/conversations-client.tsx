"use client"

import { useState, useEffect } from "react"
import { ConversationsList } from "./conversations-list"
import { ConversationMessages } from "./conversation-messages"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, RefreshCw, Users, MessageCircle, AlertCircle } from "lucide-react"

interface Client {
  cliente_id: string
  displayName: string
  totalConversations: number
  totalMessages: number
  activeConversations: number
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

type ViewMode = "clients" | "conversations" | "messages"

export function ConversationsClient() {
  const [viewMode, setViewMode] = useState<ViewMode>("clients")
  const [clients, setClients] = useState<Client[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Cargar clientes
  const loadClients = async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch("/api/dashboard/conversations")
      const data = await response.json()

      if (data.success) {
        setClients(data.clients)
      } else {
        setError(data.error || "Error cargando clientes")
      }
    } catch (error) {
      console.error("Error cargando clientes:", error)
      setError("Error de conexión")
    } finally {
      setLoading(false)
    }
  }

  // Cargar conversaciones de un cliente
  const loadConversations = async (clienteId: string) => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch(`/api/dashboard/conversations/messages?clienteId=${clienteId}`)
      const data = await response.json()

      if (data.success) {
        setConversations(data.conversations)
      } else {
        setError(data.error || "Error cargando conversaciones")
      }
    } catch (error) {
      console.error("Error cargando conversaciones:", error)
      setError("Error de conexión")
    } finally {
      setLoading(false)
    }
  }

  // Cargar mensajes de una conversación
  const loadMessages = async (configId: string, phoneNumber: string) => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch(
        `/api/dashboard/conversations/messages?configId=${configId}&phoneNumber=${phoneNumber}`,
      )
      const data = await response.json()

      if (data.success) {
        setMessages(data.messages)
      } else {
        setError(data.error || "Error cargando mensajes")
      }
    } catch (error) {
      console.error("Error cargando mensajes:", error)
      setError("Error de conexión")
    } finally {
      setLoading(false)
    }
  }

  // Manejar selección de cliente
  const handleClientSelect = async (client: Client) => {
    setSelectedClient(client)
    setViewMode("conversations")
    await loadConversations(client.cliente_id)
  }

  // Manejar selección de conversación
  const handleConversationSelect = async (conversation: Conversation) => {
    setSelectedConversation(conversation)
    setViewMode("messages")
    await loadMessages(conversation.configId, conversation.phoneNumber)
  }

  // Volver a vista anterior
  const handleBack = () => {
    if (viewMode === "messages") {
      setViewMode("conversations")
      setSelectedConversation(null)
      setMessages([])
    } else if (viewMode === "conversations") {
      setViewMode("clients")
      setSelectedClient(null)
      setConversations([])
    }
  }

  // Actualizar datos
  const handleRefresh = () => {
    if (viewMode === "clients") {
      loadClients()
    } else if (viewMode === "conversations" && selectedClient) {
      loadConversations(selectedClient.cliente_id)
    } else if (viewMode === "messages" && selectedConversation) {
      loadMessages(selectedConversation.configId, selectedConversation.phoneNumber)
    }
  }

  // Cargar clientes al montar
  useEffect(() => {
    loadClients()
  }, [])

  // Formatear tiempo relativo
  const formatRelativeTime = (timestamp: string) => {
    const now = new Date()
    const messageTime = new Date(timestamp)
    const diffMs = now.getTime() - messageTime.getTime()
    const diffMinutes = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffMinutes < 1) return "Ahora"
    if (diffMinutes < 60) return `Hace ${diffMinutes}m`
    if (diffHours < 24) return `Hace ${diffHours}h`
    if (diffDays < 7) return `Hace ${diffDays}d`
    return messageTime.toLocaleDateString()
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <div className="text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Error</h3>
            <p className="text-gray-600 mb-4">{error}</p>
            <Button onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Reintentar
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header con navegación */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          {viewMode !== "clients" && (
            <Button variant="outline" onClick={handleBack}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Volver
            </Button>
          )}

          <div>
            {viewMode === "clients" && <h2 className="text-xl font-semibold">Clientes</h2>}
            {viewMode === "conversations" && selectedClient && (
              <div>
                <h2 className="text-xl font-semibold">{selectedClient.displayName}</h2>
                <p className="text-sm text-gray-600">Conversaciones</p>
              </div>
            )}
            {viewMode === "messages" && selectedConversation && (
              <div>
                <h2 className="text-xl font-semibold">
                  {selectedConversation.userName || selectedConversation.phoneNumber}
                </h2>
                <p className="text-sm text-gray-600">{selectedConversation.phoneNumber}</p>
              </div>
            )}
          </div>
        </div>

        <Button variant="outline" onClick={handleRefresh} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {/* Contenido principal */}
      {viewMode === "clients" && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {loading ? (
            // Skeleton loading
            Array.from({ length: 6 }).map((_, i) => (
              <Card key={i}>
                <CardHeader className="pb-3">
                  <div className="h-4 bg-gray-200 rounded animate-pulse mb-2" />
                  <div className="h-3 bg-gray-200 rounded animate-pulse w-2/3" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="h-3 bg-gray-200 rounded animate-pulse" />
                    <div className="h-3 bg-gray-200 rounded animate-pulse w-3/4" />
                  </div>
                </CardContent>
              </Card>
            ))
          ) : clients.length === 0 ? (
            <Card className="col-span-full">
              <CardContent className="flex items-center justify-center py-8">
                <div className="text-center">
                  <MessageCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">No hay conversaciones</h3>
                  <p className="text-gray-600">
                    Las conversaciones aparecerán aquí cuando los usuarios interactúen con el bot
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            clients.map((client) => (
              <Card
                key={client.cliente_id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => handleClientSelect(client)}
              >
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">{client.displayName}</CardTitle>
                  <p className="text-sm text-gray-600">ID: {client.cliente_id}</p>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="flex items-center">
                      <MessageCircle className="h-4 w-4 text-blue-500 mr-2" />
                      <span>{client.totalConversations} conversaciones</span>
                    </div>
                    <div className="flex items-center">
                      <Users className="h-4 w-4 text-green-500 mr-2" />
                      <span>{client.activeConversations} activas</span>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Total mensajes</span>
                      <Badge variant="secondary">{client.totalMessages}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {viewMode === "conversations" && (
        <ConversationsList
          conversations={conversations}
          loading={loading}
          onConversationSelect={handleConversationSelect}
          formatRelativeTime={formatRelativeTime}
        />
      )}

      {viewMode === "messages" && selectedConversation && (
        <ConversationMessages
          messages={messages}
          loading={loading}
          conversation={selectedConversation}
          formatRelativeTime={formatRelativeTime}
        />
      )}
    </div>
  )
}
