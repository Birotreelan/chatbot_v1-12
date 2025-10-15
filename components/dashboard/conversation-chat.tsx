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
  const isMountedRef = useRef(true)
  const isTogglingRef = useRef(false)

  useEffect(() => {
    isMountedRef.current = true
    loadMessages()
    loadPauseStatus()

    const interval = setInterval(() => {
      if (!isTogglingRef.current) {
        loadMessages()
        loadPauseStatus()
      }
    }, 5000)

    return () => {
      isMountedRef.current = false
      clearInterval(interval)
    }
  }, [configId, phoneNumber])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  async function loadMessages() {
    try {
      const response = await fetch(`/api/conversations/messages?configId=${configId}&phoneNumber=${phoneNumber}`)
      if (!response.ok) {
        console.error("[v0] Error loading messages:", response.status)
        return
      }
      const data = await response.json()
      if (isMountedRef.current) {
        setMessages(data.messages || [])
      }
    } catch (error) {
      console.error("[v0] Error cargando mensajes:", error)
    } finally {
      if (isMountedRef.current) {
        setLoading(false)
      }
    }
  }

  async function loadPauseStatus() {
    try {
      const response = await fetch(`/api/conversations/status?configId=${configId}&phoneNumber=${phoneNumber}`)
      if (!response.ok) {
        console.error("[v0] Error loading pause status:", response.status)
        return
      }
      const data = await response.json()
      console.log("[v0] Pause status loaded:", data.isPaused)
      if (isMountedRef.current) {
        setIsPaused(data.isPaused || false)
      }
    } catch (error) {
      console.error("[v0] Error cargando estado de pausa:", error)
    }
  }

  async function togglePause() {
    if (isTogglingRef.current) {
      console.log("[v0] Toggle already in progress, skipping")
      return
    }

    isTogglingRef.current = true
    setPauseLoading(true)

    try {
      const endpoint = isPaused ? "/api/conversations/resume" : "/api/conversations/pause"
      console.log("[v0] Toggling pause state:", { endpoint, currentState: isPaused })

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configId, phoneNumber }),
      })

      if (!response.ok) {
        console.error("[v0] Error al cambiar estado de pausa:", response.status)
        return
      }

      const newPausedState = !isPaused
      console.log("[v0] Pause state changed successfully to:", newPausedState)

      if (isMountedRef.current) {
        setIsPaused(newPausedState)
      }

      setTimeout(() => {
        if (isMountedRef.current) {
          loadPauseStatus()
        }
      }, 500)
    } catch (error) {
      console.error("[v0] Error al cambiar estado de pausa:", error)
    } finally {
      if (isMountedRef.current) {
        setPauseLoading(false)
      }
      setTimeout(() => {
        isTogglingRef.current = false
      }, 1000)
    }
  }

  async function sendManualMessage() {
    if (!manualMessage.trim()) return

    setSending(true)
    try {
      console.log("[v0] Sending manual message:", manualMessage.substring(0, 50))

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
        console.log("[v0] Manual message sent successfully")
        setManualMessage("")
        await loadMessages()
      } else {
        console.error("[v0] Error al enviar mensaje:", response.status)
      }
    } catch (error) {
      console.error("[v0] Error al enviar mensaje:", error)
    } finally {
      if (isMountedRef.current) {
        setSending(false)
      }
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
              {isPaused && <span className="ml-2 text-orange-500 font-semibold">• Pausado</span>}
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
        <div className="border-t bg-muted/30 p-4">
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
