"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { User, Bot, Pause, Play, Send, Loader2 } from "lucide-react"

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
  const [isPaused, setIsPaused] = useState(false)
  const [manualMessage, setManualMessage] = useState("")
  const [sending, setSending] = useState(false)
  const [pauseLoading, setPauseLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadMessages()
    loadPauseStatus()
    const interval = setInterval(() => {
      loadMessages()
      loadPauseStatus()
    }, 5000) // Actualizar cada 5 segundos
    return () => clearInterval(interval)
  }, [configId, phoneNumber])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

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

  async function loadPauseStatus() {
    try {
      const response = await fetch(`/api/conversations/status?configId=${configId}&phoneNumber=${phoneNumber}`)
      const data = await response.json()
      setIsPaused(data.isPaused || false)
    } catch (error) {
      console.error("Error cargando estado de pausa:", error)
    }
  }

  async function togglePause() {
    setPauseLoading(true)
    try {
      const endpoint = isPaused ? "/api/conversations/resume" : "/api/conversations/pause"
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configId, phoneNumber }),
      })

      if (response.ok) {
        setIsPaused(!isPaused)
      } else {
        console.error("Error al cambiar estado de pausa")
      }
    } catch (error) {
      console.error("Error al cambiar estado de pausa:", error)
    } finally {
      setPauseLoading(false)
    }
  }

  async function sendManualMessage() {
    if (!manualMessage.trim()) return

    setSending(true)
    try {
      const response = await fetch("/api/conversations/send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          configId,
          phoneNumber,
          message: manualMessage,
        }),
      })

      if (response.ok) {
        setManualMessage("")
        await loadMessages()
      } else {
        console.error("Error al enviar mensaje")
      }
    } catch (error) {
      console.error("Error al enviar mensaje:", error)
    } finally {
      setSending(false)
    }
  }

  function handleKeyPress(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendManualMessage()
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
      <div className="border-b bg-background p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10">
            <AvatarFallback className="bg-primary text-primary-foreground">
              {phoneNumber ? phoneNumber.slice(-2) : "??"}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-semibold">{phoneNumber || "Desconocido"}</p>
            <p className="text-xs text-muted-foreground">
              {messages.length} mensajes
              {isPaused && <span className="ml-2 text-orange-500">• Pausado</span>}
            </p>
          </div>
        </div>
        <Button
          variant={isPaused ? "default" : "outline"}
          size="sm"
          onClick={togglePause}
          disabled={pauseLoading}
          className="flex items-center gap-2"
        >
          {pauseLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isPaused ? (
            <>
              <Play className="h-4 w-4" />
              Reanudar
            </>
          ) : (
            <>
              <Pause className="h-4 w-4" />
              Pausar
            </>
          )}
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
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

      {isPaused && (
        <div className="border-t bg-background p-4">
          <div className="flex gap-2">
            <Input
              placeholder="Escribe un mensaje manual..."
              value={manualMessage}
              onChange={(e) => setManualMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={sending}
              className="flex-1"
            />
            <Button onClick={sendManualMessage} disabled={sending || !manualMessage.trim()} size="icon">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            La conversación está pausada. Los mensajes del usuario se guardarán pero no se procesarán con OpenAI.
          </p>
        </div>
      )}
    </div>
  )
}
