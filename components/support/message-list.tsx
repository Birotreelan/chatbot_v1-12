"use client"

import { useEffect, useRef } from "react"
import { Badge } from "@/components/ui/badge"
import type { HumanSupportMessage } from "@/lib/types"
import { formatDistanceToNow, isToday, isYesterday, isSameDay, format } from "date-fns"
import { es } from "date-fns/locale"
import { Bot, User, UserCheck } from "lucide-react"

interface MessageListProps {
  messages: HumanSupportMessage[]
}

export function MessageList({ messages }: MessageListProps) {
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
                      Agente
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
              <p className="text-xs leading-relaxed whitespace-pre-wrap">{message.content}</p>
            </div>
          </div>
          </div>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
