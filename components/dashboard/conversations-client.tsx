"use client"

import { useState, useEffect } from "react"
import { ConversationsList } from "./conversations-list"
import { ConversationMessages } from "./conversation-messages"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
  configId: string
  clienteId: string
  userName: string
  messageCount: number
  lastMessageAt: string
  lastMessage: string
}

export function ConversationsClient() {
  const [clients, setClients] = useState<Client[]>([])
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
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
        setClients(data.data)
      }
    } catch (error) {
      console.error("Error fetching clients:", error)
    } finally {
      setLoading(false)
    }
  }

  const fetchConversations = async (clienteId: string) => {
    try {
      const response = await fetch(`/api/dashboard/conversations?clienteId=${clienteId}`)
      const data = await response.json()

      if (data.success) {
        setConversations(data.data)
      }
    } catch (error) {
      console.error("Error fetching conversations:", error)
    }
  }

  const handleClientSelect = async (client: Client) => {
    setSelectedClient(client)
    setSelectedConversation(null)
    await fetchConversations(client.cliente_id)
  }

  const handleConversationSelect = (conversation: Conversation) => {
    setSelectedConversation(conversation)
  }

  const handleBack = () => {
    if (selectedConversation) {
      setSelectedConversation(null)
    } else if (selectedClient) {
      setSelectedClient(null)
      setConversations([])
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p>Cargando conversaciones...</p>
        </div>
      </div>
    )
  }

  // Vista de mensajes de conversación específica
  if (selectedConversation) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Volver a conversaciones
          </Button>
          <div>
            <h2 className="text-xl font-semibold">
              Conversación con {selectedConversation.userName || selectedConversation.phoneNumber}
            </h2>
            <p className="text-sm text-muted-foreground">
              {selectedConversation.messageCount} mensajes • Última actividad:{" "}
              {new Date(selectedConversation.lastMessageAt).toLocaleString()}
            </p>
          </div>
        </div>

        <ConversationMessages configId={selectedConversation.configId} phoneNumber={selectedConversation.phoneNumber} />
      </div>
    )
  }

  // Vista de conversaciones de un cliente
  if (selectedClient) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Volver a clientes
          </Button>
          <div>
            <h2 className="text-xl font-semibold">{selectedClient.displayName}</h2>
            <p className="text-sm text-muted-foreground">
              {selectedClient.totalConversations} conversaciones • {selectedClient.totalMessages} mensajes
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Conversaciones</CardTitle>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{selectedClient.totalConversations}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Mensajes</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{selectedClient.totalMessages}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Conversaciones Activas</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{selectedClient.activeConversations}</div>
              <p className="text-xs text-muted-foreground">Últimas 24h</p>
            </CardContent>
          </Card>
        </div>

        <ConversationsList conversations={conversations} onConversationSelect={handleConversationSelect} />
      </div>
    )
  }

  // Vista principal de clientes
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {clients.map((client) => (
          <Card
            key={client.cliente_id}
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => handleClientSelect(client)}
          >
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{client.displayName}</span>
                <Badge variant="secondary">{client.totalConversations}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total mensajes:</span>
                  <span className="font-medium">{client.totalMessages}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Conversaciones activas:</span>
                  <span className="font-medium">{client.activeConversations}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Cliente ID:</span>
                  <span className="font-mono text-xs">{client.cliente_id}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {clients.length === 0 && (
        <Card>
          <CardContent className="text-center py-8">
            <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No hay conversaciones</h3>
            <p className="text-muted-foreground">
              Las conversaciones aparecerán aquí cuando los usuarios interactúen con el bot
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
