"use client"

import type React from "react"

import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Send, Paperclip, X, FileText, ImageIcon, AlertTriangle, Clock, MessageSquarePlus } from "lucide-react"
import {
  loQueVeElPaciente,
  MOTIVO_MAX,
  MOTIVOS_SUGERIDOS,
  validarMotivo,
} from "@/lib/reapertura-texto"
import {
  validarArchivo,
  formatearTamano,
  EXTENSIONES_ACEPTADAS,
  MIME_TYPES_ACEPTADOS,
  DIAS_RETENCION_WHATSAPP,
} from "@/lib/media-validacion"

interface MessageInputProps {
  onSend: (message: string) => Promise<void>
  /**
   * Envío de un archivo al paciente (15/9/2026). El texto del cuadro viaja
   * como epígrafe del archivo, no como un mensaje aparte: así llega junto y no
   * en dos notificaciones separadas.
   */
  onSendFile?: (file: File, caption: string) => Promise<void>
  /**
   * Estado de la ventana de 24 h de WhatsApp. Se usa para AVISAR, no para
   * bloquear: "desconocida" no es "cerrada", y aun estando cerrada según
   * nuestro registro, la autoridad es WhatsApp. Impedir el envío por un dato
   * nuestro desactualizado sería peor que dejar que falle con un error claro.
   */
  ventana?: "abierta" | "cerrada" | "desconocida"
  /**
   * Envía la plantilla que invita al paciente a autorizar la conversación
   * (9/10/2026). Si no viene, el cartel de ventana cerrada se queda en aviso,
   * como antes.
   */
  onReabrir?: (motivo: string) => Promise<void>
  /** Para la previsualización: es el nombre que va a leer el paciente. */
  nombreClinica?: string
}

export function MessageInput({
  onSend,
  onSendFile,
  ventana,
  onReabrir,
  nombreClinica,
}: MessageInputProps) {
  const [message, setMessage] = useState("")
  const [sending, setSending] = useState(false)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [errorArchivo, setErrorArchivo] = useState<string | null>(null)
  const inputArchivoRef = useRef<HTMLInputElement>(null)

  // ── Reapertura de la ventana de 24 h ──────────────────────────────────────
  const [reabriendo, setReabriendo] = useState(false)
  const [motivo, setMotivo] = useState("")
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null)
  const [invitando, setInvitando] = useState(false)

  const puedeAdjuntar = typeof onSendFile === "function"
  const puedeReabrir = typeof onReabrir === "function"
  const hayAlgoQueEnviar = archivo !== null || message.trim().length > 0

  /**
   * Manda la invitación. La validación corre acá además del servidor: el agente
   * tiene que enterarse de que un motivo promocional no sirve ANTES de gastar
   * un mensaje, no después de que el endpoint lo rechace.
   */
  async function enviarInvitacion() {
    const validado = validarMotivo(motivo)
    if (!validado.ok) {
      setErrorMotivo(validado.error)
      return
    }

    setInvitando(true)
    setErrorMotivo(null)
    try {
      await onReabrir!(validado.motivo)
      setReabriendo(false)
      setMotivo("")
    } catch (error) {
      setErrorMotivo(error instanceof Error ? error.message : "No se pudo enviar la invitación.")
    } finally {
      setInvitando(false)
    }
  }

  function elegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const elegido = e.target.files?.[0]
    // Se limpia el input para que elegir dos veces el mismo archivo vuelva a
    // disparar el evento.
    e.target.value = ""
    if (!elegido) return

    // Mismas reglas que el servidor (lib/media-validacion.ts). Acá es solo para
    // avisar sin esperar la subida; la validación que manda es la del servidor.
    const resultado = validarArchivo({
      mimeType: elegido.type,
      bytes: elegido.size,
      nombreArchivo: elegido.name,
    })

    if (!resultado.valido) {
      setArchivo(null)
      setErrorArchivo(resultado.motivo)
      return
    }

    setErrorArchivo(null)
    setArchivo(elegido)
  }

  function quitarArchivo() {
    setArchivo(null)
    setErrorArchivo(null)
  }

  async function handleSend() {
    if (!hayAlgoQueEnviar || sending) return

    setSending(true)
    try {
      if (archivo && onSendFile) {
        await onSendFile(archivo, message.trim())
        setArchivo(null)
      } else {
        await onSend(message.trim())
      }
      setMessage("")
      setErrorArchivo(null)
    } catch (error) {
      // El detalle ya lo muestra quien llama (conversation-view), que conoce el
      // motivo exacto que devolvió el servidor.
      console.error("Error al enviar:", error)
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const esImagen = archivo?.type.startsWith("image/")

  return (
    <div className="space-y-1.5">
      {/* Archivo elegido, todavía sin enviar */}
      {archivo && (
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-2 py-1.5">
          {esImagen ? (
            <ImageIcon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
          ) : (
            <FileText className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium truncate">{archivo.name}</p>
            <p className="text-[11px] text-muted-foreground">
              {formatearTamano(archivo.size)} · WhatsApp lo conserva {DIAS_RETENCION_WHATSAPP} días; después deja
              de verse en este panel.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0"
            onClick={quitarArchivo}
            disabled={sending}
            title="Quitar archivo"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Archivo rechazado antes de subirlo */}
      {errorArchivo && (
        <div className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-destructive" />
          <p className="text-[11px] text-destructive leading-snug">{errorArchivo}</p>
        </div>
      )}

      {/* ── Ventana de 24 h cerrada ──────────────────────────────────────────
          Se avisa, pero no se bloquea el botón: "cerrada" es nuestro registro y
          la autoridad es WhatsApp.

          Desde el 9/10/2026 el cartel además OFRECE una salida. Antes decía
          "hasta que el paciente vuelva a escribir" y ahí terminaba, lo que
          dejaba a la clínica esperando algo que muchas veces no pasa nunca. */}
      {ventana === "cerrada" && !reabriendo && (
        <div className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5">
          <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />
          <div className="flex-1 space-y-1.5">
            <p className="text-[11px] text-amber-800 leading-snug">
              Pasaron más de 24 h desde el último mensaje del paciente. WhatsApp probablemente rechace
              el envío hasta que el paciente vuelva a escribir.
            </p>
            {puedeReabrir && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 border-amber-400 bg-white text-[11px] text-amber-900 hover:bg-amber-100"
                onClick={() => {
                  setReabriendo(true)
                  setErrorMotivo(null)
                }}
                disabled={sending}
              >
                <MessageSquarePlus className="mr-1.5 h-3.5 w-3.5" />
                Pedirle autorización para escribirle
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ── El formulario de la invitación ───────────────────────────────────
          Va acá abajo y no en un modal a propósito: el agente está escribiendo
          en el cuadro de al lado, y un diálogo que tapa la conversación lo
          obliga a cerrarlo para releer de qué estaban hablando — que es
          justamente lo que necesita para escribir el motivo. */}
      {ventana === "cerrada" && reabriendo && (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-2.5">
          <p className="text-[11px] font-medium text-amber-900">
            Pedirle al paciente autorización para escribirle
          </p>
          <p className="text-[11px] leading-snug text-amber-800">
            Se le envía una plantilla aprobada con el motivo que indiques. Cuando toque «Aceptar
            conversación» vas a poder escribirle normalmente durante 24 h.
          </p>

          <div className="flex flex-wrap gap-1">
            {MOTIVOS_SUGERIDOS.map((sugerido) => (
              <button
                key={sugerido}
                type="button"
                className="rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[10px] text-amber-900 hover:bg-amber-100"
                onClick={() => {
                  setMotivo(sugerido)
                  setErrorMotivo(null)
                }}
              >
                {sugerido}
              </button>
            ))}
          </div>

          <div className="space-y-1">
            <Textarea
              value={motivo}
              onChange={(e) => {
                setMotivo(e.target.value.slice(0, MOTIVO_MAX))
                setErrorMotivo(null)
              }}
              placeholder="Motivo: de qué se trata, en pocas palabras"
              className="min-h-[44px] resize-none bg-white text-xs"
              disabled={invitando}
            />
            <div className="flex items-center justify-between text-[10px] text-amber-700">
              <span>
                Tiene que referirse a una gestión concreta del paciente, no a una promoción.
              </span>
              <span className="shrink-0 tabular-nums">
                {motivo.length}/{MOTIVO_MAX}
              </span>
            </div>
          </div>

          {errorMotivo && (
            <div className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              <p className="text-[11px] leading-snug text-destructive">{errorMotivo}</p>
            </div>
          )}

          {/* La previsualización sale de la misma función que arma el mensaje,
              para que lo que el agente lee y lo que el paciente recibe no
              puedan diferir. Ver lib/reapertura-texto.ts. */}
          {motivo.trim().length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-medium uppercase text-amber-700">
                Lo que va a recibir el paciente
              </p>
              <pre className="whitespace-pre-wrap rounded-md border border-amber-200 bg-white px-2 py-1.5 font-sans text-[11px] leading-snug text-foreground">
                {loQueVeElPaciente(nombreClinica || "la clínica", motivo.trim())}
              </pre>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] leading-snug text-amber-700">
              Se cobra como 1 mensaje de plantilla.
            </p>
            <div className="flex shrink-0 gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => {
                  setReabriendo(false)
                  setErrorMotivo(null)
                }}
                disabled={invitando}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                className="h-7 text-[11px]"
                onClick={enviarInvitacion}
                disabled={invitando || motivo.trim().length === 0}
              >
                {invitando ? "Enviando..." : "Enviar invitación"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        {puedeAdjuntar && (
          <>
            <input
              ref={inputArchivoRef}
              type="file"
              className="hidden"
              accept={`${EXTENSIONES_ACEPTADAS},${MIME_TYPES_ACEPTADOS}`}
              onChange={elegirArchivo}
            />
            <Button
              variant="outline"
              size="icon"
              className="h-12 w-10 shrink-0"
              onClick={() => inputArchivoRef.current?.click()}
              disabled={sending}
              title="Adjuntar imagen JPG, PNG o documento PDF"
            >
              <Paperclip className="w-4 h-4" />
            </Button>
          </>
        )}

        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={archivo ? "Texto que acompaña al archivo (opcional)..." : "Escribe tu respuesta..."}
          className="min-h-[48px] max-h-[80px] text-xs resize-none"
          disabled={sending}
        />

        <Button
          onClick={handleSend}
          disabled={!hayAlgoQueEnviar || sending}
          size="icon"
          className="h-12 w-10 shrink-0"
          title={archivo ? "Enviar archivo" : "Enviar mensaje"}
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}
