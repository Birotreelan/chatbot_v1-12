"use client"

import { useEffect, useState } from "react"
import { SessionsList } from "./sessions-list"
import { useSession } from "./session-provider"
import type { HumanSupportSession } from "@/lib/types"
import { Clock, MessageSquare, User } from "lucide-react"

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
  const { getAuthHeaders, sessionId } = useSession()

  useEffect(() => {
    loadSessions()
    // Recargar cada 10 segundos para ver nuevas sesiones
    const interval = setInterval(loadSessions, 10000)
    return () => clearInterval(interval)
  }, [])

  async function loadSessions() {
    try {
      // Construir URL con _sid para Safari fallback
      let url = "/api/support/sessions"
      if (sessionId) {
        url += `?_sid=${encodeURIComponent(sessionId)}`
      }
      
      const response = await fetch(url, {
        credentials: "include",
        headers: {
          ...getAuthHeaders(),
        },
      })
      if (!response.ok) throw new Error("Error al cargar sesiones")
      const data = await response.json()
      setSessions(Array.isArray(data.sessions) ? data.sessions : [])
      
      // Guardar info del usuario si viene en la respuesta
      if (data.userInfo) {
        setUserInfo(data.userInfo)
      }
      
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
      {/* Header compacto */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Panel de Atencion al Paciente</h1>
          <p className="text-xs text-muted-foreground">
            Gestiona las conversaciones que requieren atencion humana
          </p>
        </div>
        {userInfo && (
          <div className="flex items-center gap-1.5 text-xs bg-primary/10 text-primary px-2 py-1 rounded">
            <User className="h-3 w-3" />
            <span className="font-medium">{userInfo.displayName}</span>
          </div>
        )}
      </div>

      {/* Grid de 2 columnas */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 min-h-0">
        {/* Columna izquierda: Pendientes */}
        <div className="flex flex-col min-h-0">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-orange-500" />
              <h2 className="text-sm font-semibold">Pendientes</h2>
              <span className="bg-orange-100 text-orange-700 text-xs font-medium px-1.5 py-0.5 rounded">
                {pendingSessions.length}
              </span>
            </div>
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

        {/* Columna derecha: Activas */}
        <div className="flex flex-col min-h-0">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex items-center gap-1.5">
              <MessageSquare className="h-4 w-4 text-green-500" />
              <h2 className="text-sm font-semibold">Mis Activas</h2>
              <span className="bg-green-100 text-green-700 text-xs font-medium px-1.5 py-0.5 rounded">
                {activeSessions.length}
              </span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mb-2">Conversaciones que TU estas atendiendo</p>
          <div className="flex-1 overflow-y-auto min-h-0">
            <SessionsList
              sessions={activeSessions}
              emptyMessage="No tienes conversaciones activas"
              onUpdate={loadSessions}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
