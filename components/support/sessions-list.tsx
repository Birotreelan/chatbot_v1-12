"use client"

import { SessionCard } from "./session-card"
import type { HumanSupportSession } from "@/lib/types"
import { Inbox } from "lucide-react"

interface SessionsListProps {
  sessions: HumanSupportSession[]
  emptyMessage: string
  onUpdate: () => void
}

/**
 * Primero las que esperan respuesta, y entre ellas la que espera hace más
 * tiempo (20/10/2026).
 *
 * Se ordena acá, en el único lugar por el que pasan las dos listas, y no en el
 * dashboard: así la regla no se duplica ni se olvida en la próxima lista que se
 * agregue. En la columna de pendientes no cambia nada —ninguna tiene
 * `esperaRespuestaDesde`— y el `sort` de JS es estable, así que las que no
 * esperan conservan el orden que mandó el servidor.
 */
function ordenarPorEspera(sessions: HumanSupportSession[]): HumanSupportSession[] {
  return [...sessions].sort((a, b) => {
    const ea = a.esperaRespuestaDesde
    const eb = b.esperaRespuestaDesde
    if (ea && !eb) return -1
    if (eb && !ea) return 1
    if (ea && eb) return ea.localeCompare(eb)
    return 0
  })
}

export function SessionsList({ sessions, emptyMessage, onUpdate }: SessionsListProps) {
  if (sessions.length === 0) {
    return (
      <div className="border border-dashed rounded-lg p-4 text-center">
        <Inbox className="h-6 w-6 mx-auto text-muted-foreground/50 mb-2" />
        <p className="text-xs text-muted-foreground">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {ordenarPorEspera(sessions).map((session) => (
        <SessionCard key={session.id} session={session} onUpdate={onUpdate} />
      ))}
    </div>
  )
}
