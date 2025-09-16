"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowLeft, MessageSquare, Users } from "lucide-react"
import { ConversationsList } from "./conversations-list"
import { ConversationMessages } from "./conversation-messages"

interface Client {
  clienteId: string
  displayName: string
}

interface Conversation {
  id: string
  phoneNumber: string
  configId: string
  userName: string
  lastMessage: string
  lastMessageTime: string
  messageCount: number
}

type ViewState =
  | { type: "clients" }
  | { type: "conversations"; client: Client }
  | { type: "messages"; conversation: Conversation; client: Client }

export function ConversationsClient() {
  const [viewState, setViewState] = useState<ViewState>({ type: "clients" })
  const [clients, setClients] = useState<Client[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Cargar clientes al montar el componente
  useEffect(() => {
    loadClients()
  }, [])

  const loadClients = async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch("/api/dashboard/conversations")
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Error cargando clientes")
      }

      if (data.success) {
        setClients(data.clients || [])
      } else {
        throw new Error(data.error || "Error en la respuesta")
      }
    } catch (err) {
      console.error("Error cargando clientes:", err)
      setError(err instanceof Error ? err.message : "Error desconocido")
    } finally {
      setLoading(false)
    }
  }

  const loadConversations = async (clienteId: string) => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch(`/api/dashboard/conversations?clienteId=${encodeURIComponent(clienteId)}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Error cargando conversaciones")
      }

      if (data.success) {
        setConversations(data.conversations || [])
      } else {
        throw new Error(data.error || "Error en la respuesta")
      }
    } catch (err) {
      console.error("Error cargando conversaciones:", err)
      setError(err instanceof Error ? err.message : "Error desconocido")
    } finally {
      setLoading(false)
    }
  }

  const handleClientSelect = async (client: Client) => {
    setViewState({ type: "conversations", client })
    await loadConversations(client.clienteId)
  }

  const handleConversationSelect = (conversation: Conversation) => {
    if (viewState.type === "conversations") {
      setViewState({
        type: "messages",
        conversation,
        client: viewState.client,
      })
    }
  }

  const handleBackToClients = () => {
    setViewState({ type: "clients" })
    setConversations([])
  }

  const handleBackToConversations = () => {
    if (viewState.type === "messages") {
      setViewState({ type: "conversations", client: viewState.client })
    }
  }

  if (loading && viewState.type === "clients") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cargando clientes...</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-red-600">Error</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-red-600 mb-4">{error}</p>
          <Button onClick={loadClients} variant="outline">
            Reintentar
          </Button>
        </CardContent>
      </Card>
    )
  }

  // Vista de clientes
  if (viewState.type === "clients") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Clientes ({clients.length})
          </CardTitle>
          <CardDescription>Selecciona un cliente para ver sus conversaciones de WhatsApp</CardDescription>
        </CardHeader>
        <CardContent>
          {clients.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No hay clientes con conversaciones disponibles</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {clients.map((client) => (
                <Card
                  key={client.clienteId}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => handleClientSelect(client)}
                >
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">{client.displayName}</CardTitle>
                    <CardDescription>ID: {client.clienteId}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button variant="outline" size="sm" className="w-full bg-transparent">
                      Ver conversaciones
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  // Vista de conversaciones
  if (viewState.type === "conversations") {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleBackToClients} className="mr-2">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <MessageSquare className="h-5 w-5" />
            <div>
              <CardTitle>Conversaciones - {viewState.client.displayName}</CardTitle>
              <CardDescription>
                {conversations.length} conversación{conversations.length !== 1 ? "es" : ""} encontrada
                {conversations.length !== 1 ? "s" : ""}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : (
            <ConversationsList conversations={conversations} onConversationSelect={handleConversationSelect} />
          )}
        </CardContent>
      </Card>
    )
  }

  // Vista de mensajes
  if (viewState.type === "messages") {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleBackToConversations} className="mr-2">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <MessageSquare className="h-5 w-5" />
            <div>
              <CardTitle>
                {viewState.conversation.userName} - {viewState.client.displayName}
              </CardTitle>
              <CardDescription>
                {viewState.conversation.phoneNumber} • {viewState.conversation.messageCount} mensajes
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ConversationMessages
            phoneNumber={viewState.conversation.phoneNumber}
            configId={viewState.conversation.configId}
          />
        </CardContent>
      </Card>
    )
  }

  return null
}
