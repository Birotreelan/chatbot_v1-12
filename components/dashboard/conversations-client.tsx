"use client"

import { useState, useEffect } from "react"
import { ConversationsList } from "./conversations-list"
import { ConversationMessages } from "./conversation-messages"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowLeft, MessageSquare, Users, Activity } from "lucide-react"

interface Client {
  cliente_id: string
  displayName: string
  totalConversations: number
  totalMessages: number
  activeConversations: number
}

interface Conversation {
  phoneNumber: string
  userName?: string
  lastMessage: string
  lastMessageAt: string
  messageCount: number
  configId: string
  clienteId: string
}

type View = "clients" | "conversations" | "messages"

export function ConversationsClient() {
  const [view, setView] = useState<View>("clients")
  const [clients, setClients] = useState<Client[]>([])
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchClients()
  }, [])

  const fetchClients = async () => {
    try {
      setLoading(true)
      const response = await fetch("/api/dashboard/conversations")
      const data = await response.json()

      if (data.success) {
        setClients(data.clients || [])
      }
    } catch (error) {
      console.error("Error fetching clients:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleClientSelect = (client: Client) => {
    setSelectedClient(client)
    setView("conversations")
  }

  const handleConversationSelect = (conversation: Conversation) => {
    setSelectedConversation(conversation)
    setView("messages")
  }

  const handleBack = () => {
    if (view === "messages") {
      setView("conversations")
      setSelectedConversation(null)
    } else if (view === "conversations") {
      setView("clients")
      setSelectedClient(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-sm text-muted-foreground">Cargando conversaciones...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header con navegación */}
      {view !== "clients" && (
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Volver
          </Button>
          <div className="text-sm text-muted-foreground">
            {view === "conversations" && selectedClient && <span>Conversaciones de {selectedClient.displayName}</span>}
            {view === "messages" && selectedConversation && (
              <span>Conversación con {selectedConversation.userName || selectedConversation.phoneNumber}</span>
            )}
          </div>
        </div>
      )}

      {/* Vista de clientes */}
      {view === "clients" && (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {clients.map((client) => (
            <Card
              key={client.cliente_id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => handleClientSelect(client)}
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">{client.displayName}</CardTitle>
                <CardDescription className="text-xs">ID: {client.cliente_id}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Conversaciones</span>
                  </div>
                  <span className="font-semibold">{client.totalConversations}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Mensajes</span>
                  </div>
                  <span className="font-semibold">{client.totalMessages}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-green-500" />
                    <span className="text-sm">Activas (24h)</span>
                  </div>
                  <span className="font-semibold text-green-600">{client.activeConversations}</span>
                </div>
              </CardContent>
            </Card>
          ))}
          {clients.length === 0 && (
            <div className="col-span-full text-center py-12">
              <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No hay conversaciones</h3>
              <p className="text-muted-foreground">
                Las conversaciones aparecerán aquí cuando los usuarios interactúen con tus chatbots.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Vista de conversaciones */}
      {view === "conversations" && selectedClient && (
        <ConversationsList clienteId={selectedClient.cliente_id} onConversationSelect={handleConversationSelect} />
      )}

      {/* Vista de mensajes */}
      {view === "messages" && selectedConversation && (
        <ConversationMessages
          configId={selectedConversation.configId}
          phoneNumber={selectedConversation.phoneNumber}
          userName={selectedConversation.userName}
        />
      )}
    </div>
  )
}
