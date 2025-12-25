"use client"

import { useEffect, useRef } from "react"
import { Badge } from "@/components/ui/badge"
import type { HumanSupportMessage } from "@/lib/types"
import { formatDistanceToNow } from "date-fns"
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

  if (messages.length === 0) {
    return <div className="text-center py-8 text-muted-foreground">No hay mensajes en esta conversación</div>
  }

  return (
    <div className="space-y-4 max-h-[500px] overflow-y-auto p-4 bg-muted/30 rounded-lg">
      {messages.map((message, index) => {
        const isUser = message.role === "user"
        const isAgent = message.role === "agent"
        const isAI = message.role === "assistant"

        const timeAgo = formatDistanceToNow(new Date(message.timestamp), {
          addSuffix: true,
          locale: es,
        })

        return (
          <div key={index} className={`flex ${isUser ? "justify-start" : "justify-end"}`}>
            <div
              className={`max-w-[70%] rounded-lg p-3 ${
                isUser
                  ? "bg-white text-foreground border border-gray-200 shadow-sm"
                  : isAgent
                    ? "bg-blue-600 text-white shadow-md"
                    : "bg-gray-100 text-foreground border border-gray-200 shadow-sm"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                {isUser && (
                  <>
                    <User className="w-4 h-4" />
                    <Badge variant="outline" className="text-xs bg-white border-gray-300">
                      Paciente
                    </Badge>
                  </>
                )}
                {isAgent && (
                  <>
                    <UserCheck className="w-4 h-4" />
                    <Badge variant="outline" className="text-xs bg-blue-700 text-white border-blue-700">
                      Agente
                    </Badge>
                  </>
                )}
                {isAI && (
                  <>
                    <Bot className="w-4 h-4" />
                    <Badge variant="outline" className="text-xs bg-gray-200 border-gray-300">
                      IA
                    </Badge>
                  </>
                )}
                <span className="text-xs opacity-70">{timeAgo}</span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
            </div>
          </div>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
