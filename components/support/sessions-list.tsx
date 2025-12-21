"use client"

import { SessionCard } from "./session-card"
import type { HumanSupportSession } from "@/lib/types"

interface SessionsListProps {
  sessions: HumanSupportSession[]
  emptyMessage: string
  onUpdate: () => void
}

export function SessionsList({ sessions, emptyMessage, onUpdate }: SessionsListProps) {
  if (sessions.length === 0) {
    return <div className="border rounded-lg p-8 text-center text-muted-foreground">{emptyMessage}</div>
  }

  return (
    <div className="space-y-4">
      {sessions.map((session) => (
        <SessionCard key={session.id} session={session} onUpdate={onUpdate} />
      ))}
    </div>
  )
}
