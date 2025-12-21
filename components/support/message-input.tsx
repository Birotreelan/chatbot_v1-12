"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Send } from "lucide-react"

interface MessageInputProps {
  onSend: (message: string) => Promise<void>
}

export function MessageInput({ onSend }: MessageInputProps) {
  const [message, setMessage] = useState("")
  const [sending, setSending] = useState(false)

  async function handleSend() {
    if (!message.trim() || sending) return

    setSending(true)
    try {
      await onSend(message.trim())
      setMessage("")
    } catch (error) {
      console.error("Error:", error)
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

  return (
    <div className="flex gap-2">
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Escribe tu respuesta al usuario..."
        className="min-h-[80px]"
        disabled={sending}
      />
      <Button onClick={handleSend} disabled={!message.trim() || sending} size="icon" className="h-[80px] w-12">
        <Send className="w-4 h-4" />
      </Button>
    </div>
  )
}
