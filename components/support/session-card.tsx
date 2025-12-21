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
    console.log("[v0] [CLIENT] Iniciando asignación de sesión:", session.id)
    setAssigning(true)

    try {
      const url = `/api/support/session/${session.id}`
      console.log("[v0] [CLIENT] URL de asignación:", url)
      console.log("[v0] [CLIENT] Haciendo fetch con método POST y action: assign")

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign" }),
      })

      console.log("[v0] [CLIENT] Response status:", response.status)
      console.log("[v0] [CLIENT] Response ok:", response.ok)

      const data = await response.json()
      console.log("[v0] [CLIENT] Response data:", data)

      if (!response.ok) {
        console.error("[v0] [CLIENT] Error en response:", data)
        throw new Error(data.error || "Error al asignar sesión")
      }

      console.log("[v0] [CLIENT] Asignación exitosa, redirigiendo...")
      // Redirigir a la vista de conversación
      router.push(`/support/${session.id}`)
    } catch (error) {
      console.error("[v0] [CLIENT] Error en handleAssign:", error)
      alert("Error al asignar la conversación: " + (error instanceof Error ? error.message : "Error desconocido"))
    } finally {
      setAssigning(false)
      console.log("[v0] [CLIENT] Proceso de asignación finalizado")
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
