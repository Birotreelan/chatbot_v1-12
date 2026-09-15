"use client"

import type React from "react"

import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Send, Paperclip, X, FileText, ImageIcon, AlertTriangle, Clock } from "lucide-react"
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
}

export function MessageInput({ onSend, onSendFile, ventana }: MessageInputProps) {
  const [message, setMessage] = useState("")
  const [sending, setSending] = useState(false)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [errorArchivo, setErrorArchivo] = useState<string | null>(null)
  const inputArchivoRef = useRef<HTMLInputElement>(null)

  const puedeAdjuntar = typeof onSendFile === "function"
  const hayAlgoQueEnviar = archivo !== null || message.trim().length > 0

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

      {/* Ventana de 24 h cerrada: se avisa, pero no se bloquea el botón */}
      {ventana === "cerrada" && (
        <div className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5">
          <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />
          <p className="text-[11px] text-amber-800 leading-snug">
            Pasaron más de 24 h desde el último mensaje del paciente. WhatsApp probablemente rechace el envío
            hasta que el paciente vuelva a escribir.
          </p>
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
