"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { MessageList } from "./message-list"
import { MessageInput } from "./message-input"
import { CloseSessionDialog } from "./close-session-dialog"
import { useSession } from "./session-provider"
import type { HumanSupportSession, HumanSupportMessage } from "@/lib/types"
import { ArrowLeft, Phone, XCircle, Clock } from "lucide-react"
import { PatientInfoPanel } from "./patient-info-panel"
import { Badge } from "@/components/ui/badge"

interface ExtendedSession extends HumanSupportSession {
  messages: HumanSupportMessage[]
}

interface ConversationViewProps {
  sessionId: string
}

/** "3 h 40 min" / "25 min" — cuánto queda de la ventana de 24 h de WhatsApp. */
function describirRestante(cierreIso: string): string {
  const minutos = Math.max(0, Math.floor((new Date(cierreIso).getTime() - Date.now()) / 60000))
  if (minutos < 60) return `${minutos} min`
  const horas = Math.floor(minutos / 60)
  const resto = minutos % 60
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`
}

export function ConversationView({ sessionId }: ConversationViewProps) {
  const router = useRouter()
  const [session, setSession] = useState<ExtendedSession | null>(null)
  const [agentName, setAgentName] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCloseDialog, setShowCloseDialog] = useState(false)
  // Momento en que se cierra la ventana de 24 h de WhatsApp (15/9/2026).
  // Guardamos la fecha, no el estado, para poder recalcularlo en el cliente sin
  // depender de que el servidor nos vuelva a responder: la ventana se cierra
  // sola con el paso del tiempo, aunque no pase nada en la conversación.
  const [cierreVentana, setCierreVentana] = useState<string | null>(null)
  const [ventanaConocida, setVentanaConocida] = useState(false)
  const { getAuthHeaders, sessionId: ssoSessionId } = useSession()

  // OPTIMIZACIÓN BANDWIDTH (2026-07-06):
  // - Poll de 5s → 15s.
  // - Se pausa cuando la pestaña no está visible (una pestaña olvidada consumía GB/día).
  // - Manda ?since=<lastActivity>: si no hay novedades el server responde ~100 bytes
  //   en vez de la sesión + 100 mensajes.
  const lastActivityRef = useRef(0)

  useEffect(() => {
    loadSession()
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return
      loadSession()
    }, 15000)
    return () => clearInterval(interval)
  }, [sessionId])

  async function loadSession() {
    try {
      // Construir URL con _sid para Safari fallback
      let url = `/api/support/actions?sessionId=${sessionId}`
      if (ssoSessionId) {
        url += `&_sid=${encodeURIComponent(ssoSessionId)}`
      }
      if (lastActivityRef.current > 0) {
        url += `&since=${lastActivityRef.current}`
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

      if (typeof data.lastActivity === "number") {
        lastActivityRef.current = data.lastActivity
      }

      if (data.ventana) {
        setVentanaConocida(data.ventana.estado !== "desconocida")
        setCierreVentana(data.ventana.cierraEn ?? null)
      }

      // Sin novedades desde el último poll → mantener el estado actual
      if (data.unchanged) {
        setError(null)
        setLoading(false)
        return
      }

      setSession({
        ...data.session,
        messages: data.session.messages || [],
      })
      if (data.userInfo?.displayName) setAgentName(data.userInfo.displayName)
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

  /**
   * Envía un archivo al paciente (15/9/2026).
   *
   * Va por su propia ruta (/api/support/media) porque el cuerpo es multipart y
   * no JSON. El texto del cuadro viaja como epígrafe del archivo, para que al
   * paciente le llegue todo junto en un solo mensaje.
   */
  async function handleSendFile(archivo: File, caption: string) {
    let url = `/api/support/media`
    if (ssoSessionId) {
      url += `?_sid=${encodeURIComponent(ssoSessionId)}`
    }

    const formData = new FormData()
    formData.append("sessionId", sessionId)
    formData.append("file", archivo)
    if (caption) formData.append("caption", caption)

    // Sin Content-Type: lo pone el navegador con el boundary del multipart.
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { ...getAuthHeaders() },
      body: formData,
    })

    const data = await response.json().catch(() => null)

    if (!response.ok || !data?.success) {
      const motivo = data?.error || "No se pudo enviar el archivo."
      // Si el rechazo fue por la ventana de 24 h, actualizamos el aviso del
      // cuadro de texto: WhatsApp acaba de confirmar lo que nuestro registro
      // quizá no sabía.
      if (data?.ventanaCerrada) {
        setVentanaConocida(true)
        setCierreVentana(new Date().toISOString())
      }
      alert(motivo)
      throw new Error(motivo)
    }

    await loadSession()
  }

  /**
   * URL autenticada para pedirle un archivo de esta conversación al servidor.
   *
   * Con `descargar` el servidor responde con `Content-Disposition: attachment`
   * en vez de `inline`. Se decide del lado del servidor y no con el atributo
   * `download` del <a> porque ese atributo es una sugerencia que los
   * navegadores tratan distinto cuando el servidor ya dijo `inline`.
   */
  function construirUrlMedia(mediaId: string, descargar?: boolean): string {
    let url = `/api/support/media?sessionId=${encodeURIComponent(sessionId)}&mediaId=${encodeURIComponent(mediaId)}`
    if (descargar) url += `&descargar=1`
    if (ssoSessionId) {
      url += `&_sid=${encodeURIComponent(ssoSessionId)}`
    }
    return url
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
      let redirectUrl = "/support_proxmox"
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
    let redirectUrl = "/support_proxmox"
    if (ssoSessionId) {
      redirectUrl += `?_sid=${encodeURIComponent(ssoSessionId)}`
    }
    router.push(redirectUrl)
  }

  // Se recalcula en cada render a partir de la fecha de cierre, no del estado
  // que mandó el servidor: si el agente deja el panel abierto, la ventana se
  // cierra mientras mira la pantalla y el aviso tiene que aparecer solo.
  const estadoVentanaActual: "abierta" | "cerrada" | "desconocida" = !ventanaConocida || !cierreVentana
    ? "desconocida"
    : new Date(cierreVentana).getTime() > Date.now()
      ? "abierta"
      : "cerrada"

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
          <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">Historial de Conversacion</h3>
            {estadoVentanaActual !== "desconocida" && (
              <span
                className={`flex items-center gap-1 text-[11px] whitespace-nowrap ${
                  estadoVentanaActual === "abierta" ? "text-muted-foreground" : "text-amber-700"
                }`}
                title="WhatsApp solo permite responder libremente dentro de las 24 h posteriores al último mensaje del paciente."
              >
                <Clock className="h-3 w-3" />
                {estadoVentanaActual === "abierta"
                  ? `${describirRestante(cierreVentana!)} de ventana`
                  : "Ventana de 24 h cerrada"}
              </span>
            )}
          </div>
          
          {/* Lista de mensajes */}
          <div className="flex-1 min-h-0">
            <MessageList
              messages={session.messages}
              agentLabel={agentName}
              construirUrlMedia={construirUrlMedia}
            />
          </div>

          {/* Input para responder */}
          <div className="p-2 border-t">
            <MessageInput
              onSend={handleSendMessage}
              onSendFile={handleSendFile}
              ventana={estadoVentanaActual}
            />
          </div>
        </div>
      </div>

      {/* Dialog para cerrar */}
      <CloseSessionDialog open={showCloseDialog} onOpenChange={setShowCloseDialog} onConfirm={handleCloseSession} />
    </div>
  )
}
