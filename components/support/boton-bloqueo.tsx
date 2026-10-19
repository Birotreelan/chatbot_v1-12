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
  /** "icon" deja sólo el ícono, para encabezados sin lugar. */
  size?: "sm" | "icon"
  /** Para ajustarlo al encabezado que lo recibe. Se suma a las clases base. */
  className?: string
}

export function BotonBloqueo({
  configId,
  phoneNumber,
  bloqueado,
  sessionId,
  onCambio,
  size = "sm",
  className = "",
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

  /**
   * La altura va fija y no sale del `size` del Button (19/10/2026).
   *
   * Los encabezados donde vive esto usan `h-7 px-2 text-xs` en todos sus
   * botones. Con el `size="sm"` de la librería —que es más alto— esta fila
   * crecía, y como el nombre de la clínica y el teléfono están a la izquierda
   * con `min-w-0`, lo que cedía era el texto: el encabezado aparecía cortado
   * en "Instituto S…" por un botón que no entraba.
   *
   * `whitespace-nowrap` por el mismo motivo: "Desbloquear" partido en dos
   * renglones volvería a estirar la fila justo cuando el contacto está
   * bloqueado, que es cuando más claro tiene que verse.
   */
  const base = "h-7 shrink-0 whitespace-nowrap text-xs gap-1"
  const ancho = size === "icon" ? "w-7 px-0" : "px-2"
  const tono = bloqueado
    ? "text-amber-700 border-amber-300 hover:text-amber-800"
    : "text-muted-foreground"

  return (
    <Button
      type="button"
      variant={bloqueado ? "outline" : "ghost"}
      size="sm"
      onClick={alternar}
      disabled={procesando}
      title={
        bloqueado
          ? "Este contacto está bloqueado. Tocá para desbloquearlo."
          : "Bloquear: no se le responde ni se le envía nada"
      }
      className={`${base} ${ancho} ${tono} ${className}`.trim()}
    >
      <Icono className={`h-3.5 w-3.5 ${procesando ? "animate-spin" : ""}`} />
      {size === "sm" && (bloqueado ? "Desbloquear" : "Bloquear")}
    </Button>
  )
}
