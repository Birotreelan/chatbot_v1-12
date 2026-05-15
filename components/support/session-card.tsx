"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useSession } from "./session-provider"
import type { HumanSupportSession } from "@/lib/types"
import { formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"
import { Phone, Clock, ArrowRight, MessageSquare } from "lucide-react"

interface SessionCardProps {
  session: HumanSupportSession
  onUpdate: () => void
}

export function SessionCard({ session, onUpdate }: SessionCardProps) {
  const router = useRouter()
  const [assigning, setAssigning] = useState(false)
  const { getAuthHeaders, sessionId: ssoSessionId } = useSession()

  const priorityConfig = {
    low: { color: "bg-blue-100 text-blue-700 border-blue-200", label: "Baja" },
    medium: { color: "bg-amber-100 text-amber-700 border-amber-200", label: "Media" },
    high: { color: "bg-red-100 text-red-700 border-red-200", label: "Alta" },
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

  const isPending = session.status === "pending"

  return (
    <div className={`
      bg-card border rounded-lg p-3 
      ${isPending ? 'hover:border-primary/50 hover:shadow-sm' : 'border-green-200 bg-green-50/30'}
      transition-all duration-150
    `}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="font-medium text-sm truncate">{session.phoneNumber}</span>
        </div>
        <Badge 
          variant="outline" 
          className={`text-xs px-1.5 py-0 h-5 shrink-0 ${priorityConfig[session.priority].color}`}
        >
          {priorityConfig[session.priority].label}
        </Badge>
      </div>

      {/* Reason */}
      <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
        {session.reason}
      </p>

      {/* Footer row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>{timeAgo}</span>
        </div>

        {isPending ? (
          <Button 
            onClick={handleAssign} 
            disabled={assigning} 
            size="sm"
            className="h-7 text-xs px-3"
          >
            {assigning ? "..." : "Tomar"}
            {!assigning && <ArrowRight className="h-3 w-3 ml-1" />}
          </Button>
        ) : (
          <Button 
            onClick={handleView} 
            variant="outline" 
            size="sm"
            className="h-7 text-xs px-3 border-green-300 text-green-700 hover:bg-green-100"
          >
            <MessageSquare className="h-3 w-3 mr-1" />
            Ver
          </Button>
        )}
      </div>
    </div>
  )
}
