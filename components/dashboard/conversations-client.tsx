"use client"

import { useState, useEffect } from "react"
import { ConversationsList } from "./conversations-list"
import { ConversationMessages } from "./conversation-messages"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { MessageSquare, Users, Activity, ArrowLeft, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"

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

type ViewMode = "clients" | "conversations" | "messages"

export function ConversationsClient() {
  const [clients, setClients] = useState<Client[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>("clients")
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchClients = async () => {
    try {
      setLoading(true)
      const response = await fetch("/api/dashboard/conversations")
      const data = await response.json()

      if (data.success) {
        setClients(data.data)
      } else {
        console.error("Error fetching clients:", data.error)
      }
    } catch (error) {
      console.error("Error fetching clients:", error)
    } finally {
      setLoading(false)
    }
  }

  const fetchConversations = async (clienteId: string) => {
    try {
      setRefreshing(true)
      const response = await fetch(`/api/dashboard/conversations/messages?clienteId=${clienteId}`)
      const data = await response.json()

      if (data.success) {
        setConversations(data.data)
      } else {
        console.error("Error fetching conversations:", data.error)
      }
    } catch (error) {
      console.error("Error fetching conversations:", error)
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchClients()
  }, [])

  const handleClientSelect = async (client: Client) => {
    setSelectedClient(client)
    setViewMode("conversations")
    await fetchConversations(client.cliente_id)
  }

  const handleConversationSelect = (conversation: Conversation) => {
    setSelectedConversation(conversation)
    setViewMode("messages")
  }

  const handleBackToClients = () => {
    setSelectedClient(null)
    setConversations([])
    setViewMode("clients")
  }

  const handleBackToConversations = () => {
    setSelectedConversation(null)
    setViewMode("conversations")
  }

  const handleRefresh = () => {
    if (viewMode === "clients") {
      fetchClients()
    } else if (viewMode === "conversations" && selectedClient) {
      fetchConversations(selectedClient.cliente_id)
    }
  }

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                <div className="h-4 w-32 bg-muted animate-pulse rounded" />
              </CardTitle>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="h-6 w-16 bg-muted animate-pulse rounded" />
                <div className="h-4 w-24 bg-muted animate-pulse rounded" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (viewMode === "messages" && selectedConversation) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Button variant="outline" size="sm" onClick={handleBackToConversations}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Volver a Conversaciones
            </Button>
            <div>
              <h2 className="text-xl font-semibold">
                {selectedConversation.userName || selectedConversation.phoneNumber}
              </h2>
              <p className="text-sm text-muted-foreground">{selectedConversation.messageCount} mensajes</p>
            </div>
          </div>
        </div>

        <ConversationMessages configId={selectedConversation.configId} phoneNumber={selectedConversation.phoneNumber} />
      </div>
    )
  }

  if (viewMode === "conversations" && selectedClient) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Button variant="outline" size="sm" onClick={handleBackToClients}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Volver a Clientes
            </Button>
            <div>
              <h2 className="text-xl font-semibold">{selectedClient.displayName}</h2>
              <p className="text-sm text-muted-foreground">{conversations.length} conversaciones</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        </div>

        <ConversationsList conversations={conversations} onConversationSelect={handleConversationSelect} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Clientes con Conversaciones</h2>
          <p className="text-sm text-muted-foreground">{clients.length} clientes encontrados</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {clients.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <MessageSquare className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No hay conversaciones</h3>
            <p className="text-muted-foreground text-center">Aún no se han registrado conversaciones en el sistema.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {clients.map((client) => (
            <Card
              key={client.cliente_id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => handleClientSelect(client)}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{client.displayName}</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-bold">{client.totalConversations}</span>
                    <Badge variant="secondary">
                      <MessageSquare className="h-3 w-3 mr-1" />
                      {client.totalMessages}
                    </Badge>
                  </div>
                  <div className="flex items-center text-xs text-muted-foreground">
                    <Activity className="h-3 w-3 mr-1" />
                    {client.activeConversations} activas (24h)
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
