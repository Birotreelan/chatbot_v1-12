"use client"

import { useState, useEffect } from "react"
import { ConversationsList } from "./conversations-list"
import type { Conversation, ConversationStats } from "@/lib/types"

export default function ConversationsWrapper() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [stats, setStats] = useState<ConversationStats>({
    totalConversations: 0,
    activeConversations: 0,
    totalMessages: 0,
    averageMessagesPerConversation: 0,
    lastUpdated: new Date().toISOString(),
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = async () => {
    try {
      setLoading(true)
      setError(null)

      // Fetch conversations
      const conversationsResponse = await fetch("/api/conversations")
      if (!conversationsResponse.ok) {
        throw new Error("Error al cargar conversaciones")
      }
      const conversationsData = await conversationsResponse.json()

      // Fetch stats
      const statsResponse = await fetch("/api/conversations/stats")
      if (!statsResponse.ok) {
        throw new Error("Error al cargar estadísticas")
      }
      const statsData = await statsResponse.json()

      setConversations(conversationsData.conversations || [])
      setStats(statsData.stats || stats)
    } catch (error) {
      console.error("Error fetching conversations:", error)
      setError(error instanceof Error ? error.message : "Error desconocido")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-muted-foreground">Cargando conversaciones...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-destructive">Error: {error}</div>
      </div>
    )
  }

  return <ConversationsList conversations={conversations} stats={stats} onRefresh={fetchData} />
}
