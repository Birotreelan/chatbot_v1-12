"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConversationsList } from "./conversations-list"
import { ConversationMessages } from "./conversation-messages"
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
  configId: string
  clienteId: string
  userName?: string
  messageCount: number
  lastMessage: string
  lastMessageAt: string
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
      setClients(data.clients || [])
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
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Cargando conversaciones...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header con navegación */}
      {view !== "clients" && (
        <div className="flex items-center space-x-4">
          <Button variant="outline" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Volver
          </Button>
          <div className="text-sm text-gray-600">
            {view === "conversations" && selectedClient && <span>Conversaciones de {selectedClient.displayName}</span>}
            {view === "messages" && selectedConversation && (
              <span>
                Conversación con {selectedConversation.phoneNumber}
                {selectedConversation.userName && ` (${selectedConversation.userName})`}
              </span>
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
              className="cursor-pointer hover:shadow-lg transition-shadow"
              onClick={() => handleClientSelect(client)}
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">{client.displayName}</CardTitle>
                <p className="text-sm text-gray-600">{client.cliente_id}</p>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <MessageSquare className="h-4 w-4 text-blue-600" />
                      <span className="text-sm">Conversaciones</span>
                    </div>
                    <Badge variant="secondary">{client.totalConversations}</Badge>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Users className="h-4 w-4 text-green-600" />
                      <span className="text-sm">Mensajes totales</span>
                    </div>
                    <Badge variant="secondary">{client.totalMessages}</Badge>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Activity className="h-4 w-4 text-orange-600" />
                      <span className="text-sm">Activas (24h)</span>
                    </div>
                    <Badge variant={client.activeConversations > 0 ? "default" : "secondary"}>
                      {client.activeConversations}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
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

      {/* Estado vacío */}
      {view === "clients" && clients.length === 0 && (
        <Card>
          <CardContent className="text-center py-12">
            <MessageSquare className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No hay conversaciones</h3>
            <p className="text-gray-600">
              Las conversaciones aparecerán aquí cuando los usuarios interactúen con tus chatbots.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
