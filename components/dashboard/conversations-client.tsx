"use client"

import { useState, useEffect } from "react"
import { ConversationsList } from "./conversations-list"
import { ConversationMessages } from "./conversation-messages"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { RefreshCw, AlertCircle } from "lucide-react"

interface ClientConversation {
  clientId: string
  clientName: string
  phoneNumberId: string
  lastMessage: string
  lastMessageTime: Date
  messageCount: number
  threadId?: string
}

export function ConversationsClient() {
  const [clients, setClients] = useState<ClientConversation[]>([])
  const [selectedClient, setSelectedClient] = useState<ClientConversation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchClients = async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch("/api/dashboard/conversations")
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Error obteniendo conversaciones")
      }

      if (data.success) {
        // Convertir fechas
        const clientsWithDates = data.data.map((client: any) => ({
          ...client,
          lastMessageTime: new Date(client.lastMessageTime),
        }))

        setClients(clientsWithDates)
      } else {
        throw new Error(data.error || "Error desconocido")
      }
    } catch (error) {
      console.error("Error obteniendo conversaciones:", error)
      setError(error instanceof Error ? error.message : "Error desconocido")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchClients()
  }, [])

  const handleClientSelect = (client: ClientConversation) => {
    setSelectedClient(client)
  }

  const handleBackToList = () => {
    setSelectedClient(null)
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <RefreshCw className="h-5 w-5 animate-spin" />
            <span>Cargando conversaciones...</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center space-x-4">
                <div className="h-12 w-12 bg-gray-200 rounded-full"></div>
                <div className="space-y-2 flex-1">
                  <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                  <div className="h-3 bg-gray-200 rounded w-3/4"></div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription className="flex items-center justify-between">
          <span>Error: {error}</span>
          <Button variant="outline" size="sm" onClick={fetchClients} className="ml-4 bg-transparent">
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  if (selectedClient) {
    return <ConversationMessages client={selectedClient} onBack={handleBackToList} />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Clientes con Conversaciones</h2>
          <p className="text-muted-foreground">
            {clients.length} cliente{clients.length !== 1 ? "s" : ""} con conversaciones activas
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchClients} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {clients.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No hay conversaciones</CardTitle>
            <CardDescription>
              No se encontraron conversaciones recientes. Las conversaciones aparecerán aquí cuando los usuarios envíen
              mensajes.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ConversationsList clients={clients} onClientSelect={handleClientSelect} />
      )}
    </div>
  )
}
