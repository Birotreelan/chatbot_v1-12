"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Send, Minimize2 } from "lucide-react"

interface Message {
  id: string
  content: string
  role: "user" | "assistant"
  timestamp: Date
}

interface WidgetChatProps {
  clienteId: string
  position?: string
  embedded?: boolean
}

export default function WidgetChat({ clienteId, position = "bottom-right", embedded = false }: WidgetChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    // Mensaje de bienvenida
    setMessages([
      {
        id: "1",
        content:
          "¡Hola! Soy el asistente virtual del Instituto Oftalmológico Saravia Olmos. ¿En qué puedo ayudarte hoy?",
        role: "assistant",
        timestamp: new Date(),
      },
    ])
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      content: input.trim(),
      role: "user",
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
          message: input.trim(),
          clienteId: clienteId,
          source: "widget",
        }),
      })

      if (!response.ok) {
        throw new Error("Error en la respuesta del servidor")
      }

      const data = await response.json()

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: data.response || "Lo siento, no pude procesar tu mensaje. Por favor, intenta de nuevo.",
        role: "assistant",
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, assistantMessage])
    } catch (error) {
      console.error("Error sending message:", error)
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: "Lo siento, hubo un error al procesar tu mensaje. Por favor, intenta de nuevo más tarde.",
        role: "assistant",
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  if (isMinimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <Button
          onClick={() => setIsMinimized(false)}
          className="rounded-full w-12 h-12 bg-green-600 hover:bg-green-700 shadow-lg"
        >
          💬
        </Button>
      </div>
    )
  }

  return (
    <div className={`${embedded ? "h-full w-full" : "fixed bottom-4 right-4 z-50"}`}>
      <Card className={`${embedded ? "h-full border-0 rounded-none" : "w-80 h-96"} shadow-xl`}>
        <CardHeader className="bg-green-600 text-white p-3 flex flex-row items-center justify-between">
          <div>
            <h3 className="font-semibold text-sm">Asistente Virtual</h3>
            <p className="text-xs opacity-90">Instituto Oftalmológico</p>
          </div>
          {!embedded && (
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsMinimized(true)}
                className="text-white hover:bg-green-700 p-1 h-6 w-6"
              >
                <Minimize2 className="h-3 w-3" />
              </Button>
            </div>
          )}
        </CardHeader>

        <CardContent className="p-0 flex flex-col h-full">
          <div className={`flex-1 overflow-y-auto p-3 space-y-3 ${embedded ? "h-0" : "max-h-64"}`}>
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] p-2 rounded-lg text-sm ${
                    message.role === "user" ? "bg-green-600 text-white" : "bg-gray-100 text-gray-800"
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 p-2 rounded-lg text-sm">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                    <div
                      className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                      style={{ animationDelay: "0.1s" }}
                    ></div>
                    <div
                      className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                      style={{ animationDelay: "0.2s" }}
                    ></div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="border-t p-3">
            <form onSubmit={handleSubmit} className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Escribe tu mensaje..."
                disabled={isLoading}
                className="flex-1 text-sm"
              />
              <Button
                type="submit"
                disabled={isLoading || !input.trim()}
                size="sm"
                className="bg-green-600 hover:bg-green-700"
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// También exportar como exportación nombrada para compatibilidad
export { WidgetChat }
