"use client"

import { useState, useEffect } from "react"
import { ConversationsList } from "./conversations-list"
import { ConversationMessages } from "./conversation-messages"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { RefreshCw, ArrowLeft } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

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
  lastMessageAt: string
  lastMessage: string
}

export function ConversationsClient() {
  const [clients, setClients] = useState<Client[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const { toast } = useToast()

  const fetchClients = async () => {
    try {
      setRefreshing(true)
      const response = await fetch("/api/dashboard/conversations")
      const data = await response.json()

      if (data.success) {
        setClients(data.clients)
      } else {
        throw new Error(data.error || "Error obteniendo clientes")
      }
    } catch (error) {
      console.error("Error fetching clients:", error)
      toast({
        title: "Error",
        description: "No se pudieron cargar los clientes",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const fetchConversations = async (clientId: string) => {
    try {
      setLoading(true)
      // Por ahora, simulamos las conversaciones basadas en el cliente
      // En una implementación real, harías una llamada a la API específica
      const mockConversations: Conversation[] = [
        {
          phoneNumber: "5493413121395",
          configId: "config1",
          clienteId: clientId,
          userName: "Nicolas de Santiago",
          messageCount: 5,
          lastMessageAt: new Date().toISOString(),
          lastMessage: "Hola, necesito ayuda con mi turno",
        },
      ]

      setConversations(mockConversations)
    } catch (error) {
      console.error("Error fetching conversations:", error)
      toast({
        title: "Error",
        description: "No se pudieron cargar las conversaciones",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchClients()
  }, [])

  const handleClientSelect = (client: Client) => {
    setSelectedClient(client)
    setSelectedConversation(null)
    fetchConversations(client.cliente_id)
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

  if (loading && clients.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cargando...</CardTitle>
          <CardDescription>Obteniendo conversaciones</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-muted rounded w-3/4"></div>
            <div className="h-4 bg-muted rounded w-1/2"></div>
            <div className="h-4 bg-muted rounded w-2/3"></div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          {(selectedClient || selectedConversation) && (
            <Button variant="outline" size="sm" onClick={handleBack}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Volver
            </Button>
          )}
          <h2 className="text-lg font-semibold">
            {selectedConversation
              ? `Conversación con ${selectedConversation.userName || selectedConversation.phoneNumber}`
              : selectedClient
                ? `Conversaciones de ${selectedClient.displayName}`
                : "Clientes"}
          </h2>
        </div>

        <Button variant="outline" size="sm" onClick={fetchClients} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {selectedConversation ? (
        <ConversationMessages conversation={selectedConversation} />
      ) : selectedClient ? (
        <ConversationsList
          conversations={conversations}
          loading={loading}
          onConversationSelect={handleConversationSelect}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {clients.map((client) => (
            <Card
              key={client.cliente_id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => handleClientSelect(client)}
            >
              <CardHeader>
                <CardTitle className="text-lg">{client.displayName}</CardTitle>
                <CardDescription>Cliente ID: {client.cliente_id}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Conversaciones totales:</span>
                    <span className="font-medium">{client.totalConversations}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Mensajes totales:</span>
                    <span className="font-medium">{client.totalMessages}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Conversaciones activas:</span>
                    <span className="font-medium text-green-600">{client.activeConversations}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {clients.length === 0 && !loading && (
        <Card>
          <CardHeader>
            <CardTitle>No hay conversaciones</CardTitle>
            <CardDescription>No se encontraron conversaciones para mostrar</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Las conversaciones aparecerán aquí una vez que los usuarios comiencen a interactuar con tus chatbots.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
