"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { MessageList } from "./message-list"
import { MessageInput } from "./message-input"
import { CloseSessionDialog } from "./close-session-dialog"
import type { HumanSupportSession } from "@/lib/types"
import { ArrowLeft } from "lucide-react"

interface ConversationViewProps {
  sessionId: string
}

export function ConversationView({ sessionId }: ConversationViewProps) {
  const router = useRouter()
  const [session, setSession] = useState<HumanSupportSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCloseDialog, setShowCloseDialog] = useState(false)

  useEffect(() => {
    loadSession()
    // Recargar cada 5 segundos para ver nuevos mensajes
    const interval = setInterval(loadSession, 5000)
    return () => clearInterval(interval)
  }, [sessionId])

  async function loadSession() {
    try {
      const response = await fetch(`/api/support/actions?sessionId=${sessionId}`, {
        method: "GET",
      })
      if (!response.ok) throw new Error("Error al cargar sesión")
      const data = await response.json()
      setSession(data.session)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido")
    } finally {
      setLoading(false)
    }
  }

  async function handleSendMessage(message: string) {
    try {
      const response = await fetch(`/api/support/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "message", sessionId, message }),
      })

      if (!response.ok) throw new Error("Error al enviar mensaje")

      // Recargar sesión inmediatamente
      await loadSession()
    } catch (error) {
      console.error("Error:", error)
      alert("Error al enviar mensaje")
    }
  }

  async function handleCloseSession() {
    try {
      const response = await fetch(`/api/support/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close", sessionId }),
      })

      if (!response.ok) throw new Error("Error al cerrar sesión")

      // Volver al dashboard
      router.push("/support")
    } catch (error) {
      console.error("Error:", error)
      alert("Error al cerrar sesión")
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-muted-foreground">Cargando conversación...</div>
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-destructive">Error: {error || "Sesión no encontrada"}</div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Button variant="ghost" onClick={() => router.push("/support")} className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Volver al Panel
        </Button>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold">{session.phoneNumber}</h1>
            <p className="text-muted-foreground mt-1">{session.reason}</p>
          </div>
          <Button variant="destructive" onClick={() => setShowCloseDialog(true)}>
            Cerrar Atención
          </Button>
        </div>
      </div>

      {/* Conversación */}
      <Card>
        <CardHeader>
          <CardTitle>Historial de Conversación</CardTitle>
          <CardDescription>Todos los mensajes de esta conversación, incluyendo los del asistente de IA</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Lista de mensajes */}
            <MessageList messages={session.messages} />

            {/* Input para responder */}
            <MessageInput onSend={handleSendMessage} />
          </div>
        </CardContent>
      </Card>

      {/* Dialog para cerrar */}
      <CloseSessionDialog open={showCloseDialog} onOpenChange={setShowCloseDialog} onConfirm={handleCloseSession} />
    </div>
  )
}
