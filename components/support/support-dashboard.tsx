"use client"

import { useEffect, useState } from "react"
import { SessionsList } from "./sessions-list"
import { ConversationMonitor } from "./conversation-monitor"
import { SupportSettings } from "./support-settings"
import { useSession } from "./session-provider"
import type { HumanSupportSession } from "@/lib/types"
import { Clock, MessageSquare, User, MonitorPlay, Settings, X } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"

interface UserInfo {
  userId: string
  displayName: string
  ssoUsuarioId?: string
}

export function SupportDashboard() {
  const [sessions, setSessions] = useState<HumanSupportSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null)
  const [activeTab, setActiveTab] = useState("sessions")
  const [showSettings, setShowSettings] = useState(false)
  const { getAuthHeaders, sessionId } = useSession()

  useEffect(() => {
    loadSessions()
    const interval = setInterval(loadSessions, 10000)
    return () => clearInterval(interval)
  }, [])

  async function loadSessions() {
    try {
      let url = "/api/support/sessions"
      if (sessionId) url += `?_sid=${encodeURIComponent(sessionId)}`
      const response = await fetch(url, { credentials: "include", headers: { ...getAuthHeaders() } })
      if (!response.ok) throw new Error("Error al cargar sesiones")
      const data = await response.json()
      setSessions(Array.isArray(data.sessions) ? data.sessions : [])
      if (data.userInfo) setUserInfo(data.userInfo)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido")
      setSessions([])
    } finally {
      setLoading(false)
    }
  }

  const pendingSessions = Array.isArray(sessions) ? sessions.filter((s) => s.status === "pending") : []
  const activeSessions = Array.isArray(sessions) ? sessions.filter((s) => s.status === "in_progress") : []

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-120px)]">
        <div className="text-muted-foreground text-sm">Cargando conversaciones...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-120px)]">
        <div className="text-destructive text-sm">Error: {error}</div>
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-68px)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Panel de Atención al Paciente</h1>
          <p className="text-xs text-muted-foreground">Gestioná las conversaciones con los pacientes</p>
        </div>
        <div className="flex items-center gap-2">
          {userInfo && (
            <div className="flex items-center gap-1.5 text-xs bg-primary/10 text-primary px-2 py-1 rounded">
              <User className="h-3 w-3" />
              <span className="font-medium">{userInfo.displayName}</span>
            </div>
          )}
          <Button
            variant={showSettings ? "secondary" : "ghost"}
            size="sm"
            className="h-7 w-7 p-0"
            title="Configuración de atención"
            onClick={() => setShowSettings((v) => !v)}
          >
            {showSettings ? <X className="h-3.5 w-3.5" /> : <Settings className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {/* Settings panel (inline, collapsible) */}
      {showSettings && (
        <div className="mb-3 rounded-lg border bg-muted/20 p-4">
          <p className="text-xs font-semibold mb-3 text-foreground">Configuración de Atención Humana</p>
          <SupportSettings />
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
        <TabsList className="grid w-full grid-cols-2 mb-3">
          <TabsTrigger value="sessions" className="gap-1.5 text-xs">
            <MessageSquare className="h-3.5 w-3.5" />
            Sesiones
            {pendingSessions.length + activeSessions.length > 0 && (
              <span className="ml-1 bg-orange-100 text-orange-700 text-[10px] font-medium px-1.5 py-0.5 rounded">
                {pendingSessions.length + activeSessions.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="monitor" className="gap-1.5 text-xs">
            <MonitorPlay className="h-3.5 w-3.5" />
            Monitor
          </TabsTrigger>
        </TabsList>

        {/* Tab: Sesiones */}
        <TabsContent value="sessions" className="flex-1 min-h-0 mt-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">
            <div className="flex flex-col min-h-0">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Clock className="h-4 w-4 text-orange-500" />
                <h2 className="text-sm font-semibold">Pendientes</h2>
                <span className="bg-orange-100 text-orange-700 text-xs font-medium px-1.5 py-0.5 rounded">
                  {pendingSessions.length}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-2">Visibles para todos los agentes</p>
              <div className="flex-1 overflow-y-auto min-h-0">
                <SessionsList
                  sessions={pendingSessions}
                  emptyMessage="No hay conversaciones pendientes"
                  onUpdate={loadSessions}
                />
              </div>
            </div>

            <div className="flex flex-col min-h-0">
              <div className="flex items-center gap-1.5 mb-1.5">
                <MessageSquare className="h-4 w-4 text-green-500" />
                <h2 className="text-sm font-semibold">Mis Activas</h2>
                <span className="bg-green-100 text-green-700 text-xs font-medium px-1.5 py-0.5 rounded">
                  {activeSessions.length}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-2">Conversaciones que TÚ estás atendiendo</p>
              <div className="flex-1 overflow-y-auto min-h-0">
                <SessionsList
                  sessions={activeSessions}
                  emptyMessage="No tenés conversaciones activas"
                  onUpdate={loadSessions}
                />
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Tab: Monitor */}
        <TabsContent value="monitor" className="flex-1 min-h-0 mt-0">
          <ConversationMonitor
            currentUserId={userInfo?.userId}
            onSessionInitiated={() => {
              loadSessions()
              setActiveTab("sessions")
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
