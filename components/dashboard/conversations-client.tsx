"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MessageSquare, Users, Activity, Clock } from "lucide-react"
import { ConversationsList } from "./conversations-list"

interface Client {
  cliente_id: string
  displayName: string
  configs: any[]
  totalConversations: number
  totalMessages: number
  activeConversations: number
}

export function ConversationsClient() {
  const [clients, setClients] = useState<Client[]>([])
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchClients()
  }, [])

  async function fetchClients() {
    try {
      const response = await fetch("/api/dashboard/conversations")
      if (response.ok) {
        const data = await response.json()
        setClients(data.clients || [])
      }
    } catch (error) {
      console.error("Error al cargar clientes:", error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="p-4 border rounded-md">Cargando clientes...</div>
  }

  if (selectedClient) {
    return (
      <div>
        <div className="flex items-center gap-4 mb-6">
          <Button variant="outline" onClick={() => setSelectedClient(null)}>
            ← Volver a clientes
          </Button>
          <div>
            <h2 className="text-2xl font-bold">{selectedClient.displayName}</h2>
            <p className="text-muted-foreground">Cliente ID: {selectedClient.cliente_id}</p>
          </div>
        </div>

        <ConversationsList clienteId={selectedClient.cliente_id} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Clientes</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{clients.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Conversaciones</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {clients.reduce((sum, client) => sum + client.totalConversations, 0)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Conversaciones Activas</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {clients.reduce((sum, client) => sum + client.activeConversations, 0)}
            </div>
            <p className="text-xs text-muted-foreground">Últimas 24 horas</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Mensajes</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{clients.reduce((sum, client) => sum + client.totalMessages, 0)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {clients.map((client) => (
          <Card key={client.cliente_id} className="cursor-pointer hover:shadow-md transition-shadow">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{client.displayName}</CardTitle>
                <Badge variant={client.activeConversations > 0 ? "default" : "secondary"}>
                  {client.activeConversations > 0 ? "Activo" : "Inactivo"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">ID: {client.cliente_id}</p>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Conversaciones:</span>
                  <span className="font-medium">{client.totalConversations}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Mensajes:</span>
                  <span className="font-medium">{client.totalMessages}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Configuraciones:</span>
                  <span className="font-medium">{client.configs.length}</span>
                </div>
              </div>
              <Button className="w-full mt-4" onClick={() => setSelectedClient(client)}>
                Ver Conversaciones
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {clients.length === 0 && (
        <Card>
          <CardContent className="text-center py-8">
            <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No hay conversaciones</h3>
            <p className="text-muted-foreground">
              Las conversaciones aparecerán aquí cuando los usuarios interactúen con tus chatbots.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
