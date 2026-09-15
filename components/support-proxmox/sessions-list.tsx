"use client"

import { SessionCard } from "./session-card"
import type { HumanSupportSession } from "@/lib/types"
import { Inbox } from "lucide-react"

interface SessionsListProps {
  sessions: HumanSupportSession[]
  emptyMessage: string
  onUpdate: () => void
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
      {sessions.map((session) => (
        <SessionCard key={session.id} session={session} onUpdate={onUpdate} />
      ))}
    </div>
  )
}
