"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { HumanSupportSession } from "@/lib/types"
import { formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"

interface SessionCardProps {
  session: HumanSupportSession
  onUpdate: () => void
}

export function SessionCard({ session, onUpdate }: SessionCardProps) {
  const router = useRouter()
  const [assigning, setAssigning] = useState(false)

  const priorityColors = {
    low: "bg-blue-500",
    medium: "bg-yellow-500",
    high: "bg-red-500",
  }

  async function handleAssign() {
    setAssigning(true)
    try {
      const response = await fetch(`/api/support/session/${session.id}/assign`, {
        method: "POST",
      })

      if (!response.ok) throw new Error("Error al asignar sesión")

      // Redirigir a la vista de conversación
      router.push(`/support/${session.id}`)
    } catch (error) {
      console.error("Error:", error)
      alert("Error al asignar la conversación")
    } finally {
      setAssigning(false)
    }
  }

  function handleView() {
    router.push(`/support/${session.id}`)
  }

  const timeAgo = formatDistanceToNow(new Date(session.requestedAt), {
    addSuffix: true,
    locale: es,
  })

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-lg">{session.phoneNumber}</CardTitle>
            <CardDescription className="mt-1">{session.reason}</CardDescription>
          </div>
          <div className="flex gap-2 items-center">
            <Badge variant="outline" className={priorityColors[session.priority]}>
              {session.priority === "low" && "Baja"}
              {session.priority === "medium" && "Media"}
              {session.priority === "high" && "Alta"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">Solicitado {timeAgo}</div>

          {session.status === "pending" ? (
            <Button onClick={handleAssign} disabled={assigning} className="w-full">
              {assigning ? "Asignando..." : "Tomar Conversación"}
            </Button>
          ) : (
            <Button onClick={handleView} variant="outline" className="w-full bg-transparent">
              Ver Conversación
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
