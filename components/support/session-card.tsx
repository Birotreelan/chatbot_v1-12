"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useSession } from "./session-provider"
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
  const { getAuthHeaders, sessionId: ssoSessionId } = useSession()

  const priorityColors = {
    low: "bg-blue-500",
    medium: "bg-yellow-500",
    high: "bg-red-500",
  }

  async function handleAssign() {
    console.log("[v0] [CLIENT] Iniciando asignación de sesión:", session.id)
    setAssigning(true)

    try {
      // Construir URL con _sid para Safari fallback
      let url = `/api/support/actions`
      if (ssoSessionId) {
        url += `?_sid=${encodeURIComponent(ssoSessionId)}`
      }
      console.log("[v0] [CLIENT] URL de asignación:", url)
      console.log("[v0] [CLIENT] Haciendo fetch con método POST")

      const response = await fetch(url, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        credentials: "include",
        body: JSON.stringify({
          action: "assign",
          sessionId: session.id,
        }),
      })

      console.log("[v0] [CLIENT] Response status:", response.status)
      console.log("[v0] [CLIENT] Response ok:", response.ok)

      let data
      const contentType = response.headers.get("content-type")

      if (contentType && contentType.includes("application/json")) {
        data = await response.json()
        console.log("[v0] [CLIENT] Response data:", data)
      } else {
        const text = await response.text()
        console.error("[v0] [CLIENT] Response no es JSON:", text)
        throw new Error(`Respuesta inválida del servidor (${response.status})`)
      }

      if (!response.ok) {
        console.error("[v0] [CLIENT] Error en response:", data)
        throw new Error(data.error || "Error al asignar sesión")
      }

      console.log("[v0] [CLIENT] Asignación exitosa, actualizando lista...")
      await onUpdate()

      console.log("[v0] [CLIENT] Redirigiendo a la conversación...")
      // Incluir _sid en la URL para Safari fallback
      let redirectUrl = `/support/${session.id}`
      if (ssoSessionId) {
        redirectUrl += `?_sid=${encodeURIComponent(ssoSessionId)}`
      }
      router.push(redirectUrl)
    } catch (error) {
      console.error("[v0] [CLIENT] Error en handleAssign:", error)
      alert("Error al asignar la conversación: " + (error instanceof Error ? error.message : "Error desconocido"))
      setAssigning(false)
    } finally {
      console.log("[v0] [CLIENT] Proceso de asignación finalizado")
    }
  }

  function handleView() {
    // Incluir _sid en la URL para Safari fallback
    let redirectUrl = `/support/${session.id}`
    if (ssoSessionId) {
      redirectUrl += `?_sid=${encodeURIComponent(ssoSessionId)}`
    }
    router.push(redirectUrl)
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
