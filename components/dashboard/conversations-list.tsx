"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { MessageCircle, Phone, Clock, Search, Filter } from "lucide-react"
import type { ConversationSummary, WhatsAppConfig } from "@/lib/types"

interface ConversationsListProps {
  onSelectConversation: (conversationId: string) => void
}

export function ConversationsList({ onSelectConversation }: ConversationsListProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [configs, setConfigs] = useState<WhatsAppConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedClient, setSelectedClient] = useState<string>("all")
  const [searchTerm, setSearchTerm] = useState("")

  useEffect(() => {
    loadData()
  }, [selectedClient])

  const loadData = async () => {
    try {
      setLoading(true)

      // Cargar configuraciones
      const configsResponse = await fetch("/api/dashboard/configs")
      const configsData = await configsResponse.json()
      if (configsData.success) {
        setConfigs(configsData.data)
      }

      // Cargar conversaciones
      const url =
        selectedClient === "all"
          ? "/api/dashboard/conversations"
          : `/api/dashboard/conversations?cliente_id=${selectedClient}`

      const conversationsResponse = await fetch(url)
      const conversationsData = await conversationsResponse.json()

      if (conversationsData.success) {
        setConversations(conversationsData.data)
      }
    } catch (error) {
      console.error("Error cargando datos:", error)
    } finally {
      setLoading(false)
    }
  }

  const filteredConversations = conversations.filter((conv) => {
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase()
      return (
        conv.userName.toLowerCase().includes(searchLower) ||
        conv.phoneNumber.includes(searchTerm) ||
        conv.lastMessage.toLowerCase().includes(searchLower)
      )
    }
    return true
  })

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60)

    if (diffInHours < 1) {
      return "Hace unos minutos"
    } else if (diffInHours < 24) {
      return `Hace ${Math.floor(diffInHours)} horas`
    } else {
      return date.toLocaleDateString("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    }
  }

  const truncateMessage = (message: string, maxLength = 100) => {
    if (message.length <= maxLength) return message
    return message.substring(0, maxLength) + "..."
  }

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            Conversaciones
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <Input
                  placeholder="Buscar por nombre, teléfono o mensaje..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <div className="sm:w-64">
              <Select value={selectedClient} onValueChange={setSelectedClient}>
                <SelectTrigger>
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Filtrar por cliente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los clientes</SelectItem>
                  {configs.map((config) => (
                    <SelectItem key={config.id} value={config.cliente_id || ""}>
                      {config.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={loadData} variant="outline">
              Actualizar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Lista de conversaciones */}
      <div className="space-y-2">
        {loading ? (
          <Card>
            <CardContent className="p-6">
              <div className="text-center text-gray-500">Cargando conversaciones...</div>
            </CardContent>
          </Card>
        ) : filteredConversations.length === 0 ? (
          <Card>
            <CardContent className="p-6">
              <div className="text-center text-gray-500">
                {searchTerm
                  ? "No se encontraron conversaciones que coincidan con la búsqueda"
                  : "No hay conversaciones disponibles"}
              </div>
            </CardContent>
          </Card>
        ) : (
          filteredConversations.map((conversation) => (
            <Card
              key={conversation.id}
              className="cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => onSelectConversation(conversation.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold text-sm truncate">{conversation.userName}</h3>
                      <Badge variant="secondary" className="text-xs">
                        {conversation.clienteName}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                      <Phone className="h-3 w-3" />
                      <span>{conversation.phoneNumber}</span>
                      <span>•</span>
                      <MessageCircle className="h-3 w-3" />
                      <span>{conversation.messageCount} mensajes</span>
                    </div>

                    <p className="text-sm text-gray-600 truncate">{truncateMessage(conversation.lastMessage)}</p>
                  </div>

                  <div className="flex flex-col items-end gap-1 ml-4">
                    <div className="flex items-center gap-1 text-xs text-gray-400">
                      <Clock className="h-3 w-3" />
                      <span>{formatTime(conversation.lastMessageAt)}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
