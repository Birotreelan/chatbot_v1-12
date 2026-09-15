"use client"

import { useEffect, useRef } from "react"
import { Badge } from "@/components/ui/badge"
import type { HumanSupportMessage } from "@/lib/types"
import { formatDistanceToNow, isToday, isYesterday, isSameDay, format } from "date-fns"
import { es } from "date-fns/locale"
import { Bot, User, UserCheck, FileText, Download, FileX } from "lucide-react"
import { formatearTamano, DIAS_RETENCION_WHATSAPP } from "@/lib/media-validacion"

interface MessageListProps {
  messages: HumanSupportMessage[]
  /** Nombre a mostrar en los mensajes del lado de la clínica (por defecto "Agente"). */
  agentLabel?: string
  /**
   * Arma la URL para pedirle un archivo al servidor (15/9/2026). La provee
   * quien renderiza, porque necesita el `_sid` de la sesión SSO y este
   * componente no tiene acceso al contexto.
   */
  construirUrlMedia?: (mediaId: string) => string
}

/**
 * El texto de un mensaje con archivo incluye un marcador "[Archivo enviado: x]"
 * para que se lea bien donde no se puede renderizar nada (el monitor del
 * dashboard, el resumen que se le pasa a la IA al cerrar la sesión). Acá SÍ
 * mostramos el archivo, así que el marcador sobra y se saca.
 */
function textoSinMarcador(contenido: string): string {
  return contenido
    .replace(/\n?\[Archivo (enviado|recibido):[^\]]*\]/g, "")
    .trim()
}

export function MessageList({ messages, agentLabel, construirUrlMedia }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Auto-scroll al último mensaje
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  function formatDateLabel(date: Date): string {
    if (isToday(date)) return "Hoy"
    if (isYesterday(date)) return "Ayer"
    return format(date, "EEEE d 'de' MMMM 'de' yyyy", { locale: es })
  }

  if (messages.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
        No hay mensajes en esta conversacion
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-3 space-y-2 bg-muted/20">
      {messages.map((message, index) => {
        const isUser = message.role === "user"
        const isAgent = message.role === "agent"
        const isAI = message.role === "assistant"

        const timeAgo = formatDistanceToNow(new Date(message.timestamp), {
          addSuffix: true,
          locale: es,
        })

        const currentDate = (() => {
          try {
            const d = new Date(message.timestamp)
            return isNaN(d.getTime()) ? null : d
          } catch {
            return null
          }
        })()

        const prevDate = (() => {
          if (index === 0) return null
          try {
            const d = new Date(messages[index - 1].timestamp)
            return isNaN(d.getTime()) ? null : d
          } catch {
            return null
          }
        })()

        const showDateSeparator =
          currentDate !== null &&
          (prevDate === null || !isSameDay(currentDate, prevDate))

        return (
          <div key={index}>
            {showDateSeparator && currentDate && (
              <div className="flex items-center gap-2 my-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground font-medium px-2 py-0.5 rounded-full bg-background border capitalize whitespace-nowrap">
                  {formatDateLabel(currentDate)}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>
            )}
            <div className={`flex ${isUser ? "justify-start" : "justify-end"}`}>
            <div
              className={`max-w-[75%] rounded-lg px-2.5 py-2 ${
                isUser
                  ? "bg-white text-foreground border shadow-sm"
                  : isAgent
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted text-foreground border"
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                {isUser && (
                  <>
                    <User className="w-3 h-3" />
                    <Badge variant="outline" className="text-xs px-1 py-0 h-4 bg-white">
                      Paciente
                    </Badge>
                  </>
                )}
                {isAgent && (
                  <>
                    <UserCheck className="w-3 h-3" />
                    <Badge variant="outline" className="text-xs px-1 py-0 h-4 bg-primary-foreground/20 text-primary-foreground border-primary-foreground/30">
                      {agentLabel || "Agente"}
                    </Badge>
                  </>
                )}
                {isAI && (
                  <>
                    <Bot className="w-3 h-3" />
                    <Badge variant="outline" className="text-xs px-1 py-0 h-4">
                      IA
                    </Badge>
                  </>
                )}
                <span className="text-xs opacity-60">{timeAgo}</span>
              </div>

              {message.media && (
                <AdjuntoDelMensaje
                  media={message.media}
                  url={construirUrlMedia?.(message.media.mediaId)}
                />
              )}

              {(() => {
                const texto = message.media ? textoSinMarcador(message.content) : message.content
                if (!texto) return null
                return <p className="text-xs leading-relaxed whitespace-pre-wrap">{texto}</p>
              })()}
            </div>
          </div>
          </div>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}

/**
 * Muestra un archivo de la conversación.
 *
 * El archivo no está guardado de nuestro lado: lo pedimos a WhatsApp en el
 * momento, a través de /api/support/media. Por eso hay dos estados que no son
 * errores y hay que explicar, no esconder:
 *
 *  - Caducado: WhatsApp conserva los archivos un tiempo limitado. Pasado ese
 *    plazo, el mensaje sigue en el historial pero el archivo ya no.
 *  - Sin URL: quien renderiza no pasó `construirUrlMedia` (por ejemplo, una
 *    vista de solo lectura).
 */
function AdjuntoDelMensaje({
  media,
  url,
}: {
  media: NonNullable<HumanSupportMessage["media"]>
  url?: string
}) {
  const caducado = new Date(media.disponibleHasta).getTime() < Date.now()

  if (caducado || !url) {
    return (
      <div className="mb-1.5 flex items-start gap-1.5 rounded border border-dashed px-2 py-1.5 opacity-80">
        <FileX className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-[11px] font-medium truncate">{media.nombreArchivo}</p>
          <p className="text-[10px] opacity-70">
            {caducado
              ? `Ya no está disponible: WhatsApp conserva los archivos ${DIAS_RETENCION_WHATSAPP} días.`
              : "No se puede mostrar desde esta vista."}
          </p>
        </div>
      </div>
    )
  }

  if (media.tipo === "image") {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block mb-1.5">
        {/* Sin next/image a propósito: el archivo lo sirve nuestra propia API con
            autenticación, y el optimizador de Next no reenvía las credenciales. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={media.nombreArchivo}
          className="max-h-48 w-auto rounded border bg-background object-contain"
          loading="lazy"
        />
      </a>
    )
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mb-1.5 flex items-center gap-2 rounded border bg-background/80 px-2 py-1.5 hover:bg-background"
    >
      <FileText className="h-4 w-4 shrink-0 text-foreground/70" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium text-foreground truncate">{media.nombreArchivo}</p>
        <p className="text-[10px] text-muted-foreground">{formatearTamano(media.tamanoBytes)}</p>
      </div>
      <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </a>
  )
}
