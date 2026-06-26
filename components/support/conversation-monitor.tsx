"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "./session-provider"
import { Clock, MessageSquare, Phone, UserCheck, AlertCircle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export interface MonitorContact {
  phoneNumber: string
  lastMessage: string
  lastMessageAt: string
  messageCount: number
  configId: string
  configName: string
  isPaused: boolean
  supportSessionId?: string
}

interface ConversationMonitorProps {
  /** Called when agent initiates a session — parent can switch to the sessions view */
  onSessionInitiated?: (sessionId: string) => void
}

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "ahora"
  if (mins < 60) return `hace ${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `hace ${hrs}h`
  return `hace ${Math.floor(hrs / 24)}d`
}

function maskPhone(phone: string): string {
  if (phone.length <= 4) return phone
  return phone.slice(0, -4).replace(/\d/g, "*") + phone.slice(-4)
}

export function ConversationMonitor({ onSessionInitiated }: ConversationMonitorProps) {
  const [contacts, setContacts] = useState<MonitorContact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [initiating, setInitiating] = useState<string | null>(null) // phoneNumber being initiated
  const { getAuthHeaders, sessionId } = useSession()

  const loadContacts = useCallback(async () => {
    try {
      let url = "/api/support/monitor"
      if (sessionId) url += `?_sid=${encodeURIComponent(sessionId)}`

      const res = await fetch(url, {
        credentials: "include",
        headers: { ...getAuthHeaders() },
      })
      if (!res.ok) throw new Error("Error al cargar conversaciones")
      const data = await res.json()
      setContacts(Array.isArray(data.contacts) ? data.contacts : [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido")
    } finally {
      setLoading(false)
    }
  }, [getAuthHeaders, sessionId])

  useEffect(() => {
    loadContacts()
    const interval = setInterval(loadContacts, 15000)
    return () => clearInterval(interval)
  }, [loadContacts])

  async function handleIntervene(contact: MonitorContact) {
    const key = `${contact.configId}:${contact.phoneNumber}`
    setInitiating(key)
    try {
      let url = "/api/support/actions"
      if (sessionId) url += `?_sid=${encodeURIComponent(sessionId)}`

      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          action: "initiate",
          phoneNumber: contact.phoneNumber,
          configId: contact.configId,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        alert(data.error || "No se pudo iniciar la sesión")
        return
      }
      // Refresh list and notify parent
      await loadContacts()
      if (onSessionInitiated && data.sessionId) {
        onSessionInitiated(data.sessionId)
      }
    } catch (err) {
      alert("Error al intervenir en la conversación")
    } finally {
      setInitiating(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="text-muted-foreground text-sm">Cargando conversaciones...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-40 gap-2 text-destructive text-sm">
        <AlertCircle className="h-4 w-4" />
        <span>{error}</span>
      </div>
    )
  }

  const aiContacts = contacts.filter((c) => !c.isPaused)
  const pausedContacts = contacts.filter((c) => c.isPaused)

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {contacts.length} conversaciones · {pausedContacts.length} con agente
        </p>
        <Button variant="ghost" size="sm" onClick={loadContacts} className="h-7 px-2 gap-1 text-xs">
          <RefreshCw className="h-3 w-3" />
          Actualizar
        </Button>
      </div>

      {contacts.length === 0 && (
        <div className="flex flex-col items-center justify-center h-40 text-center gap-2">
          <MessageSquare className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No hay conversaciones aún</p>
        </div>
      )}

      {/* Paused (with human agent) */}
      {pausedContacts.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">Con agente</p>
          {pausedContacts.map((contact) => (
            <ContactRow
              key={`${contact.configId}:${contact.phoneNumber}`}
              contact={contact}
              initiating={initiating}
              onIntervene={handleIntervene}
            />
          ))}
        </div>
      )}

      {/* Active AI conversations */}
      {aiContacts.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">Con asistente virtual</p>
          {aiContacts.map((contact) => (
            <ContactRow
              key={`${contact.configId}:${contact.phoneNumber}`}
              contact={contact}
              initiating={initiating}
              onIntervene={handleIntervene}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ContactRow({
  contact,
  initiating,
  onIntervene,
}: {
  contact: MonitorContact
  initiating: string | null
  onIntervene: (c: MonitorContact) => void
}) {
  const key = `${contact.configId}:${contact.phoneNumber}`
  const isInitiating = initiating === key

  return (
    <div className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors ${
      contact.isPaused ? "border-blue-200 bg-blue-50/50" : "hover:bg-muted/50"
    }`}>
      {/* Icon */}
      <div className={`flex-shrink-0 rounded-full p-1.5 ${
        contact.isPaused ? "bg-blue-100 text-blue-600" : "bg-muted text-muted-foreground"
      }`}>
        {contact.isPaused ? <UserCheck className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-medium">{maskPhone(contact.phoneNumber)}</span>
          <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">{contact.configName}</Badge>
          {contact.isPaused && (
            <Badge className="text-[10px] px-1 py-0 h-4 bg-blue-100 text-blue-700 border-blue-200">
              Con agente
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">{contact.lastMessage || "—"}</p>
      </div>

      {/* Time + actions */}
      <div className="flex-shrink-0 flex items-center gap-2">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          {timeAgo(contact.lastMessageAt)}
        </div>

        {!contact.isPaused && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs gap-1"
            disabled={isInitiating}
            onClick={() => onIntervene(contact)}
          >
            <UserCheck className="h-3 w-3" />
            {isInitiating ? "..." : "Intervenir"}
          </Button>
        )}
      </div>
    </div>
  )
}
