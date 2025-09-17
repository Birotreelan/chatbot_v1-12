"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Search, MessageCircle, Clock, User, Phone } from "lucide-react"
import type { ConversationSummary, WhatsAppConfig } from "@/lib/types"

interface ConversationsListProps {
  onSelectConversation: (conversationId: string) => void
}

export function ConversationsList({ onSelectConversation }: ConversationsListProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [configs, setConfigs] = useState<WhatsAppConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [selectedClient, setSelectedClient] = useState<string>("all")

  useEffect(() => {
    loadConfigs()
  }, [])

  useEffect(() => {
    loadConversations()
  }, [selectedClient, search])

  const loadConfigs = async () => {
    try {
      const response = await fetch("/api/dashboard/configs")
      const data = await response.json()
      if (data.success) {
        setConfigs(data.configs)
      }
    } catch (error) {
      console.error("Error cargando configuraciones:", error)
    }
  }

  const loadConversations = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (selectedClient !== "all") {
        params.append("cliente_id", selectedClient)
      }
      if (search.trim()) {
        params.append("search", search.trim())
      }

      const response = await fetch(`/api/dashboard/conversations?${params}`)
      const data = await response.json()

      if (data.success) {
        setConversations(data.data)
      } else {
        console.error("Error cargando conversaciones:", data.error)
      }
    } catch (error) {
      console.error("Error cargando conversaciones:", error)
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60)

    if (diffInHours < 1) {
      const diffInMinutes = Math.floor(diffInHours * 60)
      return `hace ${diffInMinutes} min`
    } else if (diffInHours < 24) {
      return `hace ${Math.floor(diffInHours)} h`
    } else {
      const diffInDays = Math.floor(diffInHours / 24)
      return `hace ${diffInDays} día${diffInDays > 1 ? "s" : ""}`
    }
  }

  const truncateMessage = (message: string, maxLength = 100) => {
    if (message.length <= maxLength) return message
    return message.substring(0, maxLength) + "..."
  }

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            Conversaciones de WhatsApp
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
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
            <div className="sm:w-64">
              <Select value={selectedClient} onValueChange={setSelectedClient}>
                <SelectTrigger>
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
          </div>
        </CardContent>
      </Card>

      {/* Lista de conversaciones */}
      <div className="space-y-4">
        {loading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-2 text-gray-600">Cargando conversaciones...</p>
          </div>
        ) : conversations.length === 0 ? (
          <Card>
            <CardContent className="text-center py-8">
              <MessageCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No hay conversaciones</h3>
              <p className="text-gray-600">
                {selectedClient !== "all" || search.trim()
                  ? "No se encontraron conversaciones con los filtros aplicados."
                  : "Aún no hay conversaciones registradas."}
              </p>
            </CardContent>
          </Card>
        ) : (
          conversations.map((conversation) => (
            <Card
              key={conversation.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => onSelectConversation(conversation.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <User className="h-4 w-4 text-gray-500" />
                      <span className="font-medium text-gray-900">{conversation.userName}</span>
                      <Badge variant="outline" className="text-xs">
                        {conversation.clienteName}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <Phone className="h-4 w-4 text-gray-500" />
                      <span className="text-sm text-gray-600">{conversation.phoneNumber}</span>
                    </div>
                    <p className="text-sm text-gray-700 mb-2">{truncateMessage(conversation.lastMessage)}</p>
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <div className="flex items-center gap-1">
                        <MessageCircle className="h-3 w-3" />
                        <span>{conversation.messageCount} mensajes</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        <span>{formatDate(conversation.lastMessageAt)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Información de totales */}
      {!loading && conversations.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-gray-600 text-center">
              Mostrando {conversations.length} conversación{conversations.length !== 1 ? "es" : ""}
              {selectedClient !== "all" && (
                <span>
                  {" "}
                  para <strong>{configs.find((c) => c.cliente_id === selectedClient)?.displayName || "cliente"}</strong>
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
