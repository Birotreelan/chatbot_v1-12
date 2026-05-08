"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { MessageList } from "./message-list"
import { MessageInput } from "./message-input"
import { CloseSessionDialog } from "./close-session-dialog"
import type { HumanSupportSession, HumanSupportMessage } from "@/lib/types"
import { ArrowLeft } from "lucide-react"
import { PatientInfoPanel } from "./patient-info-panel"

interface ExtendedSession extends HumanSupportSession {
  messages: HumanSupportMessage[]
}

interface ConversationViewProps {
  sessionId: string
}

export function ConversationView({ sessionId }: ConversationViewProps) {
  const router = useRouter()
  const [session, setSession] = useState<ExtendedSession | null>(null)
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
        credentials: "include",
      })
      if (!response.ok) throw new Error("Error al cargar sesión")
      const data = await response.json()

      setSession({
        ...data.session,
        messages: data.session.messages || [],
      })
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido")
    } finally {
      setLoading(false)
    }
  }

  async function handleSendMessage(message: string) {
    try {
      console.log("[v0] [CLIENT] Enviando mensaje:", message)
      console.log("[v0] [CLIENT] SessionId:", sessionId)

      const response = await fetch(`/api/support/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "message", sessionId, message }),
      })

      console.log("[v0] [CLIENT] Response status:", response.status)
      console.log("[v0] [CLIENT] Response ok:", response.ok)

      if (!response.ok) {
        const errorData = await response.json()
        console.error("[v0] [CLIENT] Error data:", errorData)
        throw new Error(errorData.error || "Error al enviar mensaje")
      }

      const data = await response.json()
      console.log("[v0] [CLIENT] Response data:", data)

      // Recargar sesión inmediatamente
      console.log("[v0] [CLIENT] Recargando sesión...")
      await loadSession()
      console.log("[v0] [CLIENT] ✅ Mensaje enviado y sesión recargada")
    } catch (error) {
      console.error("[v0] [CLIENT] ❌ Error:", error)
      alert("Error al enviar mensaje: " + (error instanceof Error ? error.message : "Error desconocido"))
    }
  }

  async function handleCloseSession() {
    try {
      const response = await fetch(`/api/support/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
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
            Cerrar Atencion
          </Button>
        </div>
      </div>

      {/* Layout de dos columnas: Panel Paciente | Conversación */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Panel de información del paciente */}
        <div className="lg:col-span-1 order-2 lg:order-1">
          <PatientInfoPanel sessionId={sessionId} />
        </div>

        {/* Conversación */}
        <div className="lg:col-span-2 order-1 lg:order-2">
          <Card>
            <CardHeader>
              <CardTitle>Historial de Conversacion</CardTitle>
              <CardDescription>Todos los mensajes de esta conversacion, incluyendo los del asistente de IA</CardDescription>
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
        </div>
      </div>

      {/* Dialog para cerrar */}
      <CloseSessionDialog open={showCloseDialog} onOpenChange={setShowCloseDialog} onConfirm={handleCloseSession} />
    </div>
  )
}
