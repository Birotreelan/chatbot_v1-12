"use client"

/**
 * Bloquear o desbloquear un contacto, desde cualquiera de las dos vistas del
 * panel (19/10/2026).
 *
 * ── Un componente y no dos ─────────────────────────────────────────────────
 *
 * Lo usan la conversación de atención humana y el monitor de conversaciones de
 * IA. Las dos tienen que decir lo mismo sobre qué implica bloquear, y el texto
 * de la confirmación es la única explicación que alguien va a leer antes de
 * cortarle el contacto a un paciente.
 *
 * ── Qué pide confirmar ─────────────────────────────────────────────────────
 *
 * Bloquear sí, desbloquear no. Bloquear deja a un paciente sin respuesta y sin
 * recordatorios, y el que lo hace no ve el efecto —el efecto es que no pasa
 * nada—. Desbloquear sólo devuelve las cosas a su estado normal.
 */

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Ban, Loader2, ShieldOff } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface BotonBloqueoProps {
  configId: string
  phoneNumber: string
  bloqueado: boolean
  /** El `_sid` de la sesión SSO, igual que el resto de las llamadas del panel. */
  sessionId?: string | null
  /** Para que la vista recargue su estado sin saber cómo se guarda. */
  onCambio?: (bloqueado: boolean) => void
  size?: "sm" | "icon"
}

export function BotonBloqueo({
  configId,
  phoneNumber,
  bloqueado,
  sessionId,
  onCambio,
  size = "sm",
}: BotonBloqueoProps) {
  const [procesando, setProcesando] = useState(false)
  const { toast } = useToast()

  const alternar = async () => {
    if (procesando) return

    if (!bloqueado) {
      const ok = window.confirm(
        "¿Bloquear este contacto?\n\n" +
          "• No se le va a responder ningún mensaje.\n" +
          "• No va a recibir recordatorios ni ningún otro envío.\n" +
          "• Lo que mande se guarda igual, para que puedas verlo acá.\n\n" +
          "Lo podés desbloquear cuando quieras desde este mismo botón.",
      )
      if (!ok) return
    }

    setProcesando(true)
    try {
      // El `_sid` viaja en la URL incluso en el POST: es el respaldo para
      // Safari dentro del iframe, donde la cookie de sesión no llega. Mismo
      // criterio que el resto de las llamadas del panel.
      const sid = sessionId ? `_sid=${encodeURIComponent(sessionId)}` : ""
      const r = bloqueado
        ? await fetch(
            `/api/support/bloqueo?configId=${encodeURIComponent(configId)}` +
              `&phoneNumber=${encodeURIComponent(phoneNumber)}${sid ? `&${sid}` : ""}`,
            { method: "DELETE" },
          )
        : await fetch(`/api/support/bloqueo${sid ? `?${sid}` : ""}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ configId, phoneNumber }),
          })

      const datos = await r.json().catch(() => null)
      if (!r.ok || !datos?.success) {
        throw new Error(datos?.error || "No se pudo completar la acción")
      }

      onCambio?.(!bloqueado)
      toast({
        title: bloqueado ? "Contacto desbloqueado" : "Contacto bloqueado",
        description: bloqueado
          ? "Vuelve a recibir respuestas y recordatorios."
          : "No se le va a responder ni enviar nada.",
      })
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "No se pudo completar la acción",
        variant: "destructive",
      })
    } finally {
      setProcesando(false)
    }
  }

  const Icono = procesando ? Loader2 : bloqueado ? ShieldOff : Ban

  return (
    <Button
      type="button"
      variant={bloqueado ? "outline" : "ghost"}
      size={size}
      onClick={alternar}
      disabled={procesando}
      title={
        bloqueado
          ? "Este contacto está bloqueado. Tocá para desbloquearlo."
          : "Bloquear: no se le responde ni se le envía nada"
      }
      className={bloqueado ? "gap-1.5 text-amber-700 border-amber-300" : "gap-1.5 text-muted-foreground"}
    >
      <Icono className={`h-3.5 w-3.5 ${procesando ? "animate-spin" : ""}`} />
      {size === "sm" && (bloqueado ? "Desbloquear" : "Bloquear")}
    </Button>
  )
}
