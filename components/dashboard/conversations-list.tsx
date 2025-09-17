"use client"

import { useState } from "react"
import { MessageCircle, User, Clock, Eye } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { Conversation, ConversationMessage, ConversationStats } from "@/lib/types"

interface ConversationsListProps {
  conversations: Conversation[]
  stats: ConversationStats
  onRefresh: () => void
}

export function ConversationsList({ conversations, stats, onRefresh }: ConversationsListProps) {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)

  const loadMessages = async (conversationId: string) => {
    setLoadingMessages(true)
    try {
      const response = await fetch(`/api/conversations/${conversationId}/messages`)
      if (response.ok) {
        const data = await response.json()
        setMessages(data.messages || [])
      }
    } catch (error) {
      console.error("Error loading messages:", error)
    } finally {
      setLoadingMessages(false)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString("es-ES", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return (
          <Badge variant="default" className="bg-green-100 text-green-800">
            Activa
          </Badge>
        )
      case "inactive":
        return <Badge variant="secondary">Inactiva</Badge>
      case "archived":
        return <Badge variant="outline">Archivada</Badge>
      default:
        return <Badge variant="secondary">{status}</Badge>
    }
  }

  return (
    <div className="space-y-6">
      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Conversaciones</CardTitle>
            <MessageCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalConversations}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Conversaciones Activas</CardTitle>
            <User className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.activeConversations}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Mensajes</CardTitle>
            <MessageCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalMessages}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Promedio Mensajes</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.averageMessagesPerConversation}</div>
          </CardContent>
        </Card>
      </div>

      {/* Conversations Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Conversaciones</CardTitle>
              <CardDescription>Lista de todas las conversaciones registradas en el sistema</CardDescription>
            </div>
            <Button onClick={onRefresh} variant="outline" size="sm">
              Actualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuario</TableHead>
                <TableHead>Teléfono</TableHead>
                <TableHead>Configuración</TableHead>
                <TableHead>Mensajes</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Última Actividad</TableHead>
                <TableHead>Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {conversations.map((conversation) => (
                <TableRow key={conversation.id}>
                  <TableCell className="font-medium">{conversation.userName || "Usuario Anónimo"}</TableCell>
                  <TableCell>{conversation.phoneNumber}</TableCell>
                  <TableCell>{conversation.configDisplayName || "N/A"}</TableCell>
                  <TableCell>{conversation.messageCount}</TableCell>
                  <TableCell>{getStatusBadge(conversation.status)}</TableCell>
                  <TableCell>{formatDate(conversation.lastMessageAt)}</TableCell>
                  <TableCell>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedConversation(conversation)
                            loadMessages(conversation.id)
                          }}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          Ver
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-4xl max-h-[80vh]">
                        <DialogHeader>
                          <DialogTitle>
                            Conversación con {selectedConversation?.userName || "Usuario Anónimo"}
                          </DialogTitle>
                          <DialogDescription>
                            {selectedConversation?.phoneNumber} • {selectedConversation?.configDisplayName}
                          </DialogDescription>
                        </DialogHeader>
                        <ScrollArea className="h-[60vh] w-full">
                          {loadingMessages ? (
                            <div className="flex items-center justify-center p-8">
                              <div className="text-muted-foreground">Cargando mensajes...</div>
                            </div>
                          ) : (
                            <div className="space-y-4 p-4">
                              {messages.map((message) => (
                                <div
                                  key={message.id}
                                  className={`flex ${message.sender === "user" ? "justify-start" : "justify-end"}`}
                                >
                                  <div
                                    className={`max-w-[70%] rounded-lg p-3 ${
                                      message.sender === "user"
                                        ? "bg-muted text-muted-foreground"
                                        : "bg-primary text-primary-foreground"
                                    }`}
                                  >
                                    <div className="text-sm font-medium mb-1">
                                      {message.sender === "user" ? "Usuario" : "Asistente"}
                                    </div>
                                    <div className="text-sm">{message.message}</div>
                                    <div className="text-xs opacity-70 mt-2">
                                      {formatDate(message.timestamp)}
                                      {message.metadata?.processingTime && (
                                        <span className="ml-2">• {message.metadata.processingTime}ms</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                              {messages.length === 0 && (
                                <div className="text-center text-muted-foreground p-8">
                                  No hay mensajes en esta conversación
                                </div>
                              )}
                            </div>
                          )}
                        </ScrollArea>
                      </DialogContent>
                    </Dialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {conversations.length === 0 && (
            <div className="text-center text-muted-foreground p-8">No hay conversaciones registradas</div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
