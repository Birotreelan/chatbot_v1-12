"use client"

import { useState, useEffect, useRef } from "react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { User, Bot } from "lucide-react"

interface Message {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: string
}

interface ConversationChatProps {
  configId: string
  phoneNumber: string
}

export function ConversationChat({ configId, phoneNumber }: ConversationChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isUserScrollingRef = useRef(false)
  const previousMessageCountRef = useRef(0)
  const scrollTimeoutRef = useRef<NodeJS.Timeout>()

  useEffect(() => {
    loadMessages()
    const interval = setInterval(loadMessages, 5000)
    return () => clearInterval(interval)
  }, [configId, phoneNumber])

  useEffect(() => {
    const hasNewMessages = messages.length > previousMessageCountRef.current

    if (hasNewMessages && !isUserScrollingRef.current) {
      scrollToBottom()
    }

    previousMessageCountRef.current = messages.length
  }, [messages])

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50

      // Clear existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }

      // If user is at bottom, allow auto-scroll
      if (isAtBottom) {
        isUserScrollingRef.current = false
      } else {
        // User has scrolled up
        isUserScrollingRef.current = true

        // After 3 seconds of no scrolling, if they're at bottom, re-enable auto-scroll
        scrollTimeoutRef.current = setTimeout(() => {
          const { scrollTop, scrollHeight, clientHeight } = scrollContainer
          const isStillAtBottom = scrollHeight - scrollTop - clientHeight < 50
          if (isStillAtBottom) {
            isUserScrollingRef.current = false
          }
        }, 3000)
      }
    }

    scrollContainer.addEventListener("scroll", handleScroll)
    return () => {
      scrollContainer.removeEventListener("scroll", handleScroll)
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [])

  async function loadMessages() {
    try {
      const response = await fetch(`/api/conversations/messages?configId=${configId}&phoneNumber=${phoneNumber}`)
      const data = await response.json()
      setMessages(data.messages || [])
    } catch (error) {
      console.error("Error cargando mensajes:", error)
    } finally {
      setLoading(false)
    }
  }

  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Cargando conversación...</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-background p-4 flex items-center gap-3">
        <Avatar className="h-10 w-10">
          <AvatarFallback className="bg-primary text-primary-foreground">
            {phoneNumber ? phoneNumber.slice(-2) : "??"}
          </AvatarFallback>
        </Avatar>
        <div>
          <p className="font-semibold">{phoneNumber || "Desconocido"}</p>
          <p className="text-xs text-muted-foreground">{messages.length} mensajes</p>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground">No hay mensajes en esta conversación</p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={cn("flex gap-3", message.role === "user" ? "justify-end" : "justify-start")}
            >
              {message.role === "assistant" && (
                <Avatar className="h-8 w-8 flex-shrink-0">
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    <Bot className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
              )}
              <div
                className={cn(
                  "max-w-[70%] rounded-lg p-3",
                  message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                )}
              >
                <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
                <p
                  className={cn(
                    "text-xs mt-1",
                    message.role === "user" ? "text-primary-foreground/70" : "text-muted-foreground",
                  )}
                >
                  {(() => {
                    try {
                      if (!message.timestamp) return "--:--"

                      const date = new Date(message.timestamp)
                      if (isNaN(date.getTime())) return "--:--"

                      return format(date, "HH:mm", { locale: es })
                    } catch (error) {
                      return "--:--"
                    }
                  })()}
                </p>
              </div>
              {message.role === "user" && (
                <Avatar className="h-8 w-8 flex-shrink-0">
                  <AvatarFallback className="bg-muted">
                    <User className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
              )}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  )
}
