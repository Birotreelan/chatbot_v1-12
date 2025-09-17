"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Search, MessageCircle, Clock, User, Phone } from "lucide-react"
import type { Conversation, WhatsAppConfig } from "@/lib/types"

interface ConversationsListProps {
  onSelectConversation: (conversation: Conversation) => void
}

export default function ConversationsList({ onSelectConversation }: ConversationsListProps) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [configs, setConfigs] = useState<WhatsAppConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [selectedClient, setSelectedClient] = useState<string>("all")

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    loadConversations()
  }, [selectedClient, search])

  const loadData = async () => {
    try {
      // Cargar configuraciones
      const configsResponse = await fetch("/api/dashboard/configs")
      if (configsResponse.ok) {
        const configsData = await configsResponse.json()
        setConfigs(configsData.data || [])
      }

      // Cargar conversaciones
      await loadConversations()
    } catch (error) {
      console.error("Error cargando datos:", error)
    } finally {
      setLoading(false)
    }
  }

  const loadConversations = async () => {
    try {
      const params = new URLSearchParams()
      if (selectedClient !== "all") {
        params.append("cliente_id", selectedClient)
      }
      if (search.trim()) {
        params.append("search", search.trim())
      }

      const response = await fetch(`/api/dashboard/conversations?${params}`)
      if (response.ok) {
        const data = await response.json()
        setConversations(data.data || [])
      }
    } catch (error) {
      console.error("Error cargando conversaciones:", error)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60))

    if (diffInHours < 1) {
      return "Hace unos minutos"
    } else if (diffInHours < 24) {
      return `Hace ${diffInHours} hora${diffInHours > 1 ? "s" : ""}`
    } else if (diffInHours < 48) {
      return "Ayer"
    } else {
      return date.toLocaleDateString("es-ES", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
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
          Conversaciones ({conversations.length})
        </CardTitle>

        {/* Filtros */}
        <div className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-1">
              <Select value={selectedClient} onValueChange={setSelectedClient}>
                <SelectTrigger>
                  <SelectValue placeholder="Filtrar por cliente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los clientes</SelectItem>
                  {configs.map((config) => (
                    <SelectItem key={config.cliente_id} value={config.cliente_id}>
                      {config.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input
              placeholder="Buscar por nombre, teléfono o mensaje..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {conversations.length === 0 ? (
          <div className="text-center py-8">
            <MessageCircle className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">No se encontraron conversaciones</p>
            {(selectedClient !== "all" || search.trim()) && (
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedClient("all")
                  setSearch("")
                }}
                className="mt-2"
              >
                Limpiar filtros
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {conversations.map((conversation) => (
              <div
                key={conversation.id}
                onClick={() => onSelectConversation(conversation)}
                className="p-4 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <User className="h-4 w-4 text-gray-400" />
                      <span className="font-medium text-sm truncate">{conversation.userName}</span>
                      <Badge variant="secondary" className="text-xs">
                        {conversation.clienteName}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-2 mb-2">
                      <Phone className="h-3 w-3 text-gray-400" />
                      <span className="text-xs text-gray-500">{conversation.phoneNumber}</span>
                    </div>

                    <p className="text-sm text-gray-600 truncate">{conversation.lastMessage || "Sin mensajes"}</p>
                  </div>

                  <div className="flex flex-col items-end gap-1 ml-4">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3 text-gray-400" />
                      <span className="text-xs text-gray-500">{formatDate(conversation.lastMessageAt)}</span>
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
