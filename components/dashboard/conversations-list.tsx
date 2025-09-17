"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Search, MessageCircle, User, Calendar, Filter } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Conversation } from "@/lib/types"

interface ConversationsListProps {
  onSelectConversation: (conversation: Conversation) => void
  selectedConversationId?: string
}

export default function ConversationsList({ onSelectConversation, selectedConversationId }: ConversationsListProps) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [filteredConversations, setFilteredConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedClient, setSelectedClient] = useState<string>("all")
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([])

  useEffect(() => {
    fetchConversations()
  }, [])

  useEffect(() => {
    filterConversations()
  }, [conversations, searchTerm, selectedClient])

  const fetchConversations = async () => {
    try {
      setLoading(true)
      const response = await fetch("/api/dashboard/conversations", {
        headers: {
          Authorization: `Basic ${btoa(`${process.env.NEXT_PUBLIC_ADMIN_USERNAME || "admin"}:${process.env.NEXT_PUBLIC_ADMIN_PASSWORD || "password"}`)}`,
        },
      })

      if (!response.ok) {
        throw new Error("Error al cargar conversaciones")
      }

      const data = await response.json()
      if (data.success) {
        setConversations(data.conversations)

        // Extraer clientes únicos
        const uniqueClients = Array.from(
          new Map(
            data.conversations.map((conv: Conversation) => [
              conv.clienteId,
              { id: conv.clienteId, name: conv.clienteName },
            ]),
          ).values(),
        )
        setClients(uniqueClients)
      }
    } catch (error) {
      console.error("Error fetching conversations:", error)
    } finally {
      setLoading(false)
    }
  }

  const filterConversations = () => {
    let filtered = conversations

    // Filtrar por cliente
    if (selectedClient !== "all") {
      filtered = filtered.filter((conv) => conv.clienteId === selectedClient)
    }

    // Filtrar por término de búsqueda
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(
        (conv) =>
          conv.userName.toLowerCase().includes(term) ||
          conv.phoneNumber.includes(term) ||
          conv.lastMessage.toLowerCase().includes(term),
      )
    }

    setFilteredConversations(filtered)
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60)

    if (diffInHours < 1) {
      return "Hace unos minutos"
    } else if (diffInHours < 24) {
      return `Hace ${Math.floor(diffInHours)} horas`
    } else {
      return date.toLocaleDateString("es-ES", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            Conversaciones
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-500">Cargando conversaciones...</p>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5" />
          Conversaciones ({filteredConversations.length})
        </CardTitle>

        {/* Filtros */}
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input
              placeholder="Buscar por nombre, teléfono o mensaje..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-500" />
            <Select value={selectedClient} onValueChange={setSelectedClient}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Filtrar por cliente" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los clientes</SelectItem>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {filteredConversations.length === 0 ? (
          <div className="text-center py-8 px-4">
            <MessageCircle className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">
              {searchTerm || selectedClient !== "all"
                ? "No se encontraron conversaciones con los filtros aplicados"
                : "No hay conversaciones disponibles"}
            </p>
            {(searchTerm || selectedClient !== "all") && (
              <Button
                variant="outline"
                onClick={() => {
                  setSearchTerm("")
                  setSelectedClient("all")
                }}
                className="mt-2"
              >
                Limpiar filtros
              </Button>
            )}
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {filteredConversations.map((conversation) => (
              <div
                key={conversation.id}
                onClick={() => onSelectConversation(conversation)}
                className={`p-4 border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors ${
                  selectedConversationId === conversation.id ? "bg-blue-50 border-blue-200" : ""
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <User className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      <span className="font-medium text-gray-900 truncate">{conversation.userName}</span>
                      <Badge variant="secondary" className="text-xs">
                        {conversation.clienteName}
                      </Badge>
                    </div>

                    <p className="text-sm text-gray-600 mb-1">📱 {conversation.phoneNumber}</p>

                    <p className="text-sm text-gray-500 line-clamp-2">{conversation.lastMessage || "Sin mensajes"}</p>
                  </div>

                  <div className="flex flex-col items-end gap-1 ml-2">
                    <div className="flex items-center gap-1 text-xs text-gray-400">
                      <Calendar className="h-3 w-3" />
                      {formatDate(conversation.lastMessageAt)}
                    </div>

                    <Badge variant="outline" className="text-xs">
                      {conversation.messageCount} mensajes
                    </Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
