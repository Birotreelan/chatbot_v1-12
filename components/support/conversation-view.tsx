"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { MessageList } from "./message-list"
import { MessageInput } from "./message-input"
import { CloseSessionDialog } from "./close-session-dialog"
import { useSession } from "./session-provider"
import type { HumanSupportSession, HumanSupportMessage } from "@/lib/types"
import { ArrowLeft, Phone, XCircle } from "lucide-react"
import { PatientInfoPanel } from "./patient-info-panel"
import { Badge } from "@/components/ui/badge"

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
  const { getAuthHeaders, sessionId: ssoSessionId } = useSession()

  useEffect(() => {
    loadSession()
    // Recargar cada 5 segundos para ver nuevos mensajes
    const interval = setInterval(loadSession, 5000)
    return () => clearInterval(interval)
  }, [sessionId])

  async function loadSession() {
    try {
      // Construir URL con _sid para Safari fallback
      let url = `/api/support/actions?sessionId=${sessionId}`
      if (ssoSessionId) {
        url += `&_sid=${encodeURIComponent(ssoSessionId)}`
      }
      
      const response = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers: {
          ...getAuthHeaders(),
        },
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

      // Construir URL con _sid para Safari fallback
      let url = `/api/support/actions`
      if (ssoSessionId) {
        url += `?_sid=${encodeURIComponent(ssoSessionId)}`
      }

      const response = await fetch(url, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
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
      console.log("[v0] [CLIENT] Mensaje enviado y sesión recargada")
    } catch (error) {
      console.error("[v0] [CLIENT] Error:", error)
      alert("Error al enviar mensaje: " + (error instanceof Error ? error.message : "Error desconocido"))
    }
  }

  async function handleCloseSession() {
    try {
      // Construir URL con _sid para Safari fallback
      let url = `/api/support/actions`
      if (ssoSessionId) {
        url += `?_sid=${encodeURIComponent(ssoSessionId)}`
      }

      const response = await fetch(url, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        credentials: "include",
        body: JSON.stringify({ action: "close", sessionId }),
      })

      if (!response.ok) throw new Error("Error al cerrar sesión")

      // Volver al dashboard (incluir _sid para Safari fallback)
      let redirectUrl = "/support"
      if (ssoSessionId) {
        redirectUrl += `?_sid=${encodeURIComponent(ssoSessionId)}`
      }
      router.push(redirectUrl)
    } catch (error) {
      console.error("Error:", error)
      alert("Error al cerrar sesión")
    }
  }

  // Función para volver al panel con _sid
  const handleBackToPanel = () => {
    let redirectUrl = "/support"
    if (ssoSessionId) {
      redirectUrl += `?_sid=${encodeURIComponent(ssoSessionId)}`
    }
    router.push(redirectUrl)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-120px)]">
        <div className="text-muted-foreground text-sm">Cargando conversacion...</div>
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-120px)]">
        <div className="text-destructive text-sm">Error: {error || "Sesion no encontrada"}</div>
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-68px)] flex flex-col">
      {/* Header compacto */}
      <div className="flex items-center justify-between mb-3 pb-2 border-b">
        <div className="flex items-center gap-3">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleBackToPanel}
            className="h-7 px-2 text-xs"
          >
            <ArrowLeft className="h-3 w-3 mr-1" />
            Volver
          </Button>
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">{session.phoneNumber}</span>
            <Badge variant="outline" className="text-xs h-5">
              {session.priority === "high" ? "Alta" : session.priority === "medium" ? "Media" : "Baja"}
            </Badge>
          </div>
        </div>
        <Button 
          variant="ghost" 
          size="sm"
          onClick={() => setShowCloseDialog(true)}
          className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <XCircle className="h-3 w-3 mr-1" />
          Cerrar Atencion
        </Button>
      </div>

      {/* Motivo */}
      <p className="text-xs text-muted-foreground mb-3 line-clamp-1">{session.reason}</p>

      {/* Layout de 2 columnas: Panel Paciente (fijo) | Chat */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Panel de información del paciente - ancho fijo */}
        <div className="w-56 shrink-0 overflow-y-auto">
          <PatientInfoPanel sessionId={sessionId} />
        </div>

        {/* Conversación - ocupa el resto */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-card rounded-lg border">
          {/* Header del chat */}
          <div className="px-3 py-2 border-b bg-muted/30">
            <h3 className="text-xs font-medium text-muted-foreground">Historial de Conversacion</h3>
          </div>
          
          {/* Lista de mensajes */}
          <div className="flex-1 min-h-0">
            <MessageList messages={session.messages} />
          </div>

          {/* Input para responder */}
          <div className="p-2 border-t">
            <MessageInput onSend={handleSendMessage} />
          </div>
        </div>
      </div>

      {/* Dialog para cerrar */}
      <CloseSessionDialog open={showCloseDialog} onOpenChange={setShowCloseDialog} onConfirm={handleCloseSession} />
    </div>
  )
}
