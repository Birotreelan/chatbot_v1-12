"use client"

import { useEffect, useState } from "react"
import { SessionsList } from "./sessions-list"
import type { HumanSupportSession } from "@/lib/types"

export function SupportDashboard() {
  const [sessions, setSessions] = useState<HumanSupportSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadSessions()
    // Recargar cada 10 segundos para ver nuevas sesiones
    const interval = setInterval(loadSessions, 10000)
    return () => clearInterval(interval)
  }, [])

  async function loadSessions() {
    try {
      const response = await fetch("/api/support/sessions")
      if (!response.ok) throw new Error("Error al cargar sesiones")
      const data = await response.json()
      setSessions(data.sessions)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido")
    } finally {
      setLoading(false)
    }
  }

  const pendingSessions = sessions.filter((s) => s.status === "pending")
  const activeSessions = sessions.filter((s) => s.status === "in_progress")

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-muted-foreground">Cargando conversaciones...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-destructive">Error: {error}</div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Panel de Atención al Cliente</h1>
        <p className="text-muted-foreground mt-2">Gestiona las conversaciones que requieren atención humana</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Columna izquierda: Pendientes */}
        <div>
          <div className="mb-4">
            <h2 className="text-xl font-semibold">Conversaciones Pendientes ({pendingSessions.length})</h2>
            <p className="text-sm text-muted-foreground">Conversaciones esperando ser atendidas</p>
          </div>
          <SessionsList
            sessions={pendingSessions}
            emptyMessage="No hay conversaciones pendientes"
            onUpdate={loadSessions}
          />
        </div>

        {/* Columna derecha: Activas */}
        <div>
          <div className="mb-4">
            <h2 className="text-xl font-semibold">Mis Conversaciones Activas ({activeSessions.length})</h2>
            <p className="text-sm text-muted-foreground">Conversaciones que estás atendiendo actualmente</p>
          </div>
          <SessionsList
            sessions={activeSessions}
            emptyMessage="No tienes conversaciones activas"
            onUpdate={loadSessions}
          />
        </div>
      </div>
    </div>
  )
}
