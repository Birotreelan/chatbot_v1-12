"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { nanoid } from "nanoid"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MessageSquare, Send, X, Minimize2, Maximize2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface Message {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: Date
}

interface ChatWidgetProps {
  configId: string
  title?: string
  primaryColor?: string
  secondaryColor?: string
  position?: "bottom-right" | "bottom-left"
  welcomeMessage?: string
}

export function ChatWidget({
  configId,
  title = "Asistente Virtual",
  primaryColor = "#0ea5e9",
  secondaryColor = "#f0f9ff",
  position = "bottom-right",
  welcomeMessage = "¡Hola! ¿En qué puedo ayudarte hoy?",
}: ChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [sessionId, setSessionId] = useState<string>("")
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Inicializar sessionId y mensaje de bienvenida
  useEffect(() => {
    // Intentar recuperar sessionId del localStorage
    const storedSessionId = localStorage.getItem(`chat-session-${configId}`)
    const newSessionId = storedSessionId || nanoid()

    if (!storedSessionId) {
      localStorage.setItem(`chat-session-${configId}`, newSessionId)
    }

    setSessionId(newSessionId)

    // Agregar mensaje de bienvenida si no hay mensajes
    if (welcomeMessage) {
      setMessages([
        {
          id: nanoid(),
          role: "assistant",
          content: welcomeMessage,
          timestamp: new Date(),
        },
      ])
    }
  }, [configId, welcomeMessage])

  // Scroll al último mensaje
  useEffect(() => {
    if (messagesEndRef.current && isOpen) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages, isOpen])

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault()

    if (!input.trim() || isLoading) return

    const userMessage = {
      id: nanoid(),
      role: "user" as const,
      content: input,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsLoading(true)

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: input,
          sessionId,
          configId,
        }),
      })

      if (!response.ok) {
        throw new Error("Error al enviar mensaje")
      }

      const data = await response.json()

      setMessages((prev) => [
        ...prev,
        {
          id: nanoid(),
          role: "assistant",
          content: data.message,
          timestamp: new Date(),
        },
      ])
    } catch (error) {
      console.error("Error:", error)
      setMessages((prev) => [
        ...prev,
        {
          id: nanoid(),
          role: "system",
          content: "Lo siento, ha ocurrido un error. Por favor, intenta de nuevo más tarde.",
          timestamp: new Date(),
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const toggleChat = () => {
    setIsOpen(!isOpen)
    if (!isOpen) {
      setIsMinimized(false)
    }
  }

  const toggleMinimize = () => {
    setIsMinimized(!isMinimized)
  }

  const positionClasses = position === "bottom-right" ? "bottom-4 right-4" : "bottom-4 left-4"

  return (
    <div className={`fixed ${positionClasses} z-50`}>
      {/* Botón flotante cuando el chat está cerrado */}
      {!isOpen && (
        <Button
          onClick={toggleChat}
          className="rounded-full w-14 h-14 shadow-lg"
          style={{ backgroundColor: primaryColor }}
        >
          <MessageSquare className="w-6 h-6" />
        </Button>
      )}

      {/* Ventana de chat */}
      {isOpen && (
        <div
          className="bg-white rounded-lg shadow-xl flex flex-col"
          style={{ width: "350px", height: isMinimized ? "auto" : "500px" }}
        >
          {/* Cabecera */}
          <div className="p-3 rounded-t-lg flex justify-between items-center" style={{ backgroundColor: primaryColor }}>
            <h3 className="font-medium text-white">{title}</h3>
            <div className="flex gap-2">
              <button onClick={toggleMinimize} className="text-white hover:text-gray-200">
                {isMinimized ? <Maximize2 size={18} /> : <Minimize2 size={18} />}
              </button>
              <button onClick={toggleChat} className="text-white hover:text-gray-200">
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Cuerpo del chat */}
          {!isMinimized && (
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "max-w-[80%] p-3 rounded-lg",
                    msg.role === "user"
                      ? "bg-blue-500 text-white self-end"
                      : msg.role === "system"
                        ? "bg-red-100 text-red-800 self-start"
                        : "bg-gray-100 text-gray-800 self-start",
                  )}
                >
                  {msg.content}
                </div>
              ))}
              {isLoading && (
                <div className="bg-gray-100 text-gray-800 self-start max-w-[80%] p-3 rounded-lg">
                  <div className="flex gap-1">
                    <div
                      className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
                      style={{ animationDelay: "0ms" }}
                    ></div>
                    <div
                      className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
                      style={{ animationDelay: "150ms" }}
                    ></div>
                    <div
                      className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
                      style={{ animationDelay: "300ms" }}
                    ></div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Formulario de entrada */}
          {!isMinimized && (
            <form onSubmit={handleSendMessage} className="p-3 border-t flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Escribe un mensaje..."
                disabled={isLoading}
                className="flex-1"
              />
              <Button type="submit" disabled={isLoading || !input.trim()} style={{ backgroundColor: primaryColor }}>
                <Send size={18} />
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
