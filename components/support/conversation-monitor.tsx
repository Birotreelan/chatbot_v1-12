"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useSession } from "./session-provider"
import { MessageList } from "./message-list"
import { MessageInput } from "./message-input"
import {
  Clock,
  MessageSquare,
  UserCheck,
  AlertCircle,
  RefreshCw,
  Phone,
  Bot,
  Inbox,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { HumanSupportMessage } from "@/lib/types"

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface ActiveSessionInfo {
  id: string
  status: string
  assignedTo: string | null
}

interface ConversationData {
  messages: HumanSupportMessage[]
  activeSession: ActiveSessionInfo | null
  configName: string
}

interface ConversationMonitorProps {
  onSessionInitiated?: (sessionId: string) => void
  /** userId of the logged-in agent (to check if session is assigned to them) */
  currentUserId?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "ahora"
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

function maskPhone(phone: string): string {
  if (phone.length <= 4) return phone
  return phone.slice(0, -4).replace(/\d/g, "·") + phone.slice(-4)
}

// ─── Contact Row ──────────────────────────────────────────────────────────────

function ContactRow({
  contact,
  selected,
  onClick,
}: {
  contact: MonitorContact
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all flex items-start gap-2.5 ${
        selected
          ? "border-primary bg-primary/5"
          : contact.isPaused
          ? "border-blue-200 bg-blue-50/40 hover:bg-blue-50"
          : "border-transparent hover:border-border hover:bg-muted/50"
      }`}
    >
      <div
        className={`mt-0.5 flex-shrink-0 rounded-full p-1.5 ${
          contact.isPaused
            ? "bg-blue-100 text-blue-600"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {contact.isPaused ? (
          <UserCheck className="h-3 w-3" />
        ) : (
          <Bot className="h-3 w-3" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span className="font-mono text-xs font-semibold truncate">
            {maskPhone(contact.phoneNumber)}
          </span>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {timeAgo(contact.lastMessageAt)}
          </span>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-[10px] text-muted-foreground truncate flex-1">
            {contact.lastMessage || "—"}
          </span>
          {contact.isPaused && (
            <Badge className="text-[9px] px-1 py-0 h-3.5 bg-blue-100 text-blue-700 border-blue-200 shrink-0">
              Agente
            </Badge>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground/60 mt-0.5">{contact.configName}</p>
      </div>
    </button>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ConversationMonitor({ onSessionInitiated, currentUserId }: ConversationMonitorProps) {
  const [contacts, setContacts] = useState<MonitorContact[]>([])
  const [contactsLoading, setContactsLoading] = useState(true)
  const [contactsError, setContactsError] = useState<string | null>(null)

  const [selectedContact, setSelectedContact] = useState<MonitorContact | null>(null)
  const [conversation, setConversation] = useState<ConversationData | null>(null)
  const [convLoading, setConvLoading] = useState(false)

  const [initiating, setInitiating] = useState(false)
  const [sending, setSending] = useState(false)

  const { getAuthHeaders, sessionId } = useSession()
  const convPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Track whether the current contact has already received its initial full load
  const isInitialLoadRef = useRef(true)

  // ── Load contacts ──────────────────────────────────────────────────────────
  const loadContacts = useCallback(async () => {
    try {
      let url = "/api/support/monitor"
      if (sessionId) url += `?_sid=${encodeURIComponent(sessionId)}`
      const res = await fetch(url, { credentials: "include", headers: { ...getAuthHeaders() } })
      if (!res.ok) throw new Error("Error al cargar conversaciones")
      const data = await res.json()
      const newContacts: MonitorContact[] = Array.isArray(data.contacts) ? data.contacts : []
      setContacts(newContacts)
      setContactsError(null)

      // Update selected contact's isPaused/supportSessionId if it changed
      if (selectedContact) {
        const updated = newContacts.find(
          (c) => c.phoneNumber === selectedContact.phoneNumber && c.configId === selectedContact.configId
        )
        if (updated) setSelectedContact(updated)
      }
    } catch (err) {
      setContactsError(err instanceof Error ? err.message : "Error desconocido")
    } finally {
      setContactsLoading(false)
    }
  }, [getAuthHeaders, sessionId, selectedContact])

  // Contacts poll: reduced from 15s → 30s (2× less reads)
  useEffect(() => {
    loadContacts()
    const interval = setInterval(loadContacts, 30000)
    return () => clearInterval(interval)
  }, []) // intentionally omit loadContacts to avoid restart loop

  // ── Load conversation ──────────────────────────────────────────────────────
  // initial=true  → limit=50 (full history, shown once when contact is selected)
  // initial=false → limit=10 (only last 10 msgs, merged by ID to detect new ones)
  // This reduces poll bandwidth by ~15× (10 msgs × 500 B vs 150 msgs × 500 B)
  const loadConversation = useCallback(
    async (contact: MonitorContact, initial = false) => {
      if (initial) setConvLoading(true)
      try {
        const limit = initial ? 50 : 10
        let url = `/api/support/monitor/conversation?configId=${contact.configId}&phoneNumber=${encodeURIComponent(contact.phoneNumber)}&limit=${limit}`
        if (sessionId) url += `&_sid=${encodeURIComponent(sessionId)}`
        const res = await fetch(url, { credentials: "include", headers: { ...getAuthHeaders() } })
        if (!res.ok) throw new Error("Error al cargar conversación")
        const data = await res.json()
        const incoming: HumanSupportMessage[] = data.messages || []

        if (initial) {
          // Full replace on initial load
          setConversation({
            messages: incoming,
            activeSession: data.activeSession || null,
            configName: data.configName || contact.configName,
          })
        } else {
          // Incremental: merge by message ID — only append truly new messages
          setConversation((prev) => {
            if (!prev) return {
              messages: incoming,
              activeSession: data.activeSession || null,
              configName: data.configName || contact.configName,
            }
            const existingIds = new Set(prev.messages.map((m) => m.id))
            const newMsgs = incoming.filter((m) => !existingIds.has(m.id))
            return {
              ...prev,
              activeSession: data.activeSession || prev.activeSession,
              messages: newMsgs.length > 0 ? [...prev.messages, ...newMsgs] : prev.messages,
            }
          })
        }
      } catch (err) {
        console.error("[Monitor] Error cargando conversación:", err)
      } finally {
        if (initial) setConvLoading(false)
      }
    },
    [getAuthHeaders, sessionId]
  )

  // Poll conversation when one is selected
  // Interval reduced from 5s → 20s (4× less calls)
  useEffect(() => {
    if (convPollRef.current) clearInterval(convPollRef.current)
    if (!selectedContact) return
    isInitialLoadRef.current = true
    loadConversation(selectedContact, true) // full initial load
    isInitialLoadRef.current = false
    convPollRef.current = setInterval(() => loadConversation(selectedContact, false), 20000)
    return () => {
      if (convPollRef.current) clearInterval(convPollRef.current)
    }
  }, [selectedContact?.phoneNumber, selectedContact?.configId])

  // ── Intervenir ─────────────────────────────────────────────────────────────
  async function handleIntervene() {
    if (!selectedContact) return
    setInitiating(true)
    try {
      let url = "/api/support/actions"
      if (sessionId) url += `?_sid=${encodeURIComponent(sessionId)}`
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          action: "initiate",
          phoneNumber: selectedContact.phoneNumber,
          configId: selectedContact.configId,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        alert(data.error || "No se pudo iniciar la sesión")
        return
      }
      // Refresh everything
      await loadContacts()
      await loadConversation(selectedContact)
      if (onSessionInitiated && data.sessionId) onSessionInitiated(data.sessionId)
    } catch {
      alert("Error al intervenir en la conversación")
    } finally {
      setInitiating(false)
    }
  }

  // ── Send message (only when assigned to this agent) ────────────────────────
  async function handleSendMessage(message: string) {
    if (!conversation?.activeSession) return
    setSending(true)
    try {
      let url = "/api/support/actions"
      if (sessionId) url += `?_sid=${encodeURIComponent(sessionId)}`
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ action: "message", sessionId: conversation.activeSession.id, message }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Error al enviar")
      }
      if (selectedContact) await loadConversation(selectedContact)
    } catch (err) {
      alert("Error al enviar mensaje: " + (err instanceof Error ? err.message : "Error desconocido"))
    } finally {
      setSending(false)
    }
  }

  // ── Computed ───────────────────────────────────────────────────────────────
  const isMySession =
    conversation?.activeSession?.assignedTo === currentUserId ||
    conversation?.activeSession?.status === "in_progress"
  const canIntervene = selectedContact && !selectedContact.isPaused
  const canChat = !!conversation?.activeSession && isMySession

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full gap-0 min-h-0 rounded-lg border overflow-hidden">
      {/* ── Left: contacts list ─────────────────────────────────────────────── */}
      <div className="w-64 shrink-0 flex flex-col border-r min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
          <div className="flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold">Conversaciones</span>
            {contacts.length > 0 && (
              <span className="bg-muted text-muted-foreground text-[10px] font-medium px-1.5 py-0.5 rounded">
                {contacts.length}
              </span>
            )}
          </div>
          <button
            onClick={loadContacts}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Actualizar"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
          {contactsLoading && (
            <p className="text-xs text-muted-foreground text-center py-4">Cargando...</p>
          )}
          {contactsError && (
            <div className="flex items-center gap-1.5 text-destructive text-xs p-2">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>{contactsError}</span>
            </div>
          )}
          {!contactsLoading && !contactsError && contacts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <Inbox className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground text-center">No hay conversaciones aún</p>
            </div>
          )}
          {contacts.map((c) => (
            <ContactRow
              key={`${c.configId}:${c.phoneNumber}`}
              contact={c}
              selected={
                selectedContact?.phoneNumber === c.phoneNumber &&
                selectedContact?.configId === c.configId
              }
              onClick={() => setSelectedContact(c)}
            />
          ))}
        </div>
      </div>

      {/* ── Right: conversation ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {!selectedContact ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
            <Phone className="h-10 w-10 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground">Seleccioná un contacto para ver la conversación</p>
          </div>
        ) : (
          <>
            {/* Conversation header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/20 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <Phone className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="font-mono text-sm font-semibold truncate">
                  {selectedContact.phoneNumber}
                </span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                  {selectedContact.configName}
                </Badge>
                {selectedContact.isPaused && (
                  <Badge className="text-[10px] px-1.5 py-0 h-4 bg-blue-100 text-blue-700 border-blue-200 shrink-0">
                    Con agente
                  </Badge>
                )}
              </div>

              {/* Action button */}
              {canIntervene && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-3 text-xs gap-1.5 shrink-0"
                  disabled={initiating}
                  onClick={handleIntervene}
                >
                  <UserCheck className="h-3.5 w-3.5" />
                  {initiating ? "Iniciando..." : "Intervenir"}
                </Button>
              )}
              {conversation?.activeSession && !isMySession && (
                <span className="text-xs text-muted-foreground">Atendido por otro agente</span>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 min-h-0 overflow-hidden">
              {convLoading && !conversation ? (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                  Cargando conversación...
                </div>
              ) : (
                <MessageList messages={conversation?.messages || []} />
              )}
            </div>

            {/* Message input — only when this agent has the session */}
            {canChat && (
              <div className="px-3 py-2 border-t shrink-0">
                <MessageInput onSend={handleSendMessage} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
