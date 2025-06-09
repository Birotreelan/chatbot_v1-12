"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Send } from "lucide-react"

interface Message {
  id: string
  content: string
  isUser: boolean
  timestamp: Date
}

interface WidgetChatProps {
  clienteId: string
  config: {
    widgetTitle?: string
    widgetSubtitle?: string
    widgetWelcomeMessage?: string
    widgetPlaceholder?: string
    widgetPrimaryColor?: string
    widgetSecondaryColor?: string
  }
}

export default function WidgetChat({ clienteId, config }: WidgetChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string>("")
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Generar session_id único al montar el componente
  useEffect(() => {
    const newSessionId = `web_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    setSessionId(newSessionId)
    console.log("[WIDGET-CHAT] Session ID generado:", newSessionId)

    // Agregar mensaje de bienvenida
    if (config.widgetWelcomeMessage) {
      setMessages([
        {
          id: "welcome",
          content: config.widgetWelcomeMessage,
          isUser: false,
          timestamp: new Date(),
        },
      ])
    }
  }, [config.widgetWelcomeMessage])

  // Scroll automático al final
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Función simplificada para detectar opciones numeradas en el texto
  const detectNumberedOptions = (text: string) => {
    console.log("[WIDGET-CHAT] Analizando texto:", text)

    // Buscar patrones como "1. Opción" o "1- Opción" o "1) Opción"
    // Esta expresión regular es más simple y robusta
    const optionRegex = /(\d+)[\s]*[.)-][\s]+(.*?)(?=\s+\d+[\s]*[.)-]|$)/g
    const matches = Array.from(text.matchAll(optionRegex))

    console.log("[WIDGET-CHAT] Matches encontrados:", matches.length)

    if (matches.length < 2) {
      return { hasOptions: false, options: [], cleanText: text }
    }

    const options = matches.map((match) => ({
      number: match[1],
      text: match[2].trim(),
    }))

    console.log("[WIDGET-CHAT] Opciones detectadas:", options)

    // Extraer el texto principal (antes de las opciones)
    const firstOptionIndex = text.indexOf(matches[0][0])
    const cleanText = firstOptionIndex > 0 ? text.substring(0, firstOptionIndex).trim() : text

    return { hasOptions: true, options, cleanText }
  }

  const handleOptionClick = async (optionNumber: string) => {
    if (isLoading) return

    console.log("[WIDGET-CHAT] Opción seleccionada:", optionNumber)

    const optionMessage: Message = {
      id: Date.now().toString(),
      content: optionNumber,
      isUser: true,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, optionMessage])
    setIsLoading(true)

    try {
      console.log("[WIDGET-CHAT] Enviando opción seleccionada:", {
        option: optionNumber,
        cliente_id: clienteId,
        session_id: sessionId,
      })

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: optionNumber,
          cliente_id: clienteId,
          session_id: sessionId,
        }),
      })

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      console.log("[WIDGET-CHAT] Respuesta recibida:", data)

      if (data.success && data.response) {
        const botMessage: Message = {
          id: (Date.now() + 1).toString(),
          content: data.response,
          isUser: false,
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, botMessage])
      } else {
        throw new Error(data.error || "Error desconocido")
      }
    } catch (error) {
      console.error("[WIDGET-CHAT] Error enviando opción:", error)
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: "Lo siento, ha ocurrido un error. Por favor, intenta nuevamente.",
        isUser: false,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const sendMessage = async () => {
    if (!inputValue.trim() || isLoading || !sessionId) return

    const userMessage: Message = {
      id: Date.now().toString(),
      content: inputValue.trim(),
      isUser: true,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInputValue("")
    setIsLoading(true)

    try {
      console.log("[WIDGET-CHAT] Enviando mensaje:", {
        message: userMessage.content,
        cliente_id: clienteId,
        session_id: sessionId,
      })

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: userMessage.content,
          cliente_id: clienteId,
          session_id: sessionId,
        }),
      })

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      console.log("[WIDGET-CHAT] Respuesta recibida:", data)

      if (data.success && data.response) {
        console.log("[WIDGET-CHAT] Contenido de la respuesta:", data.response)

        const botMessage: Message = {
          id: (Date.now() + 1).toString(),
          content: data.response,
          isUser: false,
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, botMessage])
      } else {
        throw new Error(data.error || "Error desconocido")
      }
    } catch (error) {
      console.error("[WIDGET-CHAT] Error enviando mensaje:", error)
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: "Lo siento, ha ocurrido un error. Por favor, intenta nuevamente.",
        isUser: false,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="p-4 text-white relative" style={{ backgroundColor: config.widgetPrimaryColor || "#0ea5e9" }}>
        <div className="text-left">
          <h3 className="font-semibold text-lg">{config.widgetTitle || "Asistente Virtual"}</h3>
          <p className="text-sm opacity-90">{config.widgetSubtitle || "Estamos aquí para ayudarte"}</p>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => {
          // Solo procesar mensajes del bot (no del usuario)
          const result = !message.isUser
            ? detectNumberedOptions(message.content)
            : { hasOptions: false, options: [], cleanText: message.content }
          const { hasOptions, options, cleanText } = result

          console.log("[WIDGET-CHAT] Mensaje procesado:", {
            id: message.id,
            isUser: message.isUser,
            hasOptions,
            optionsCount: options.length,
            showButtons: !message.isUser && hasOptions && options.length > 0,
          })

          return (
            <div key={message.id} className={`flex ${message.isUser ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[80%]">
                <div
                  className={`rounded-lg p-3 ${message.isUser ? "text-white" : "bg-gray-100 text-gray-800"}`}
                  style={{
                    backgroundColor: message.isUser ? config.widgetPrimaryColor || "#0ea5e9" : undefined,
                  }}
                >
                  <p className="text-sm whitespace-pre-wrap text-left">
                    {hasOptions && !message.isUser ? cleanText : message.content}
                  </p>
                  <p className={`text-xs mt-1 ${message.isUser ? "text-white/70" : "text-gray-500"}`}>
                    {formatTime(message.timestamp)}
                  </p>
                </div>

                {/* Mostrar botones de opciones solo para mensajes del bot */}
                {!message.isUser && hasOptions && options.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {options.map((option, index) => (
                      <button
                        key={index}
                        onClick={() => handleOptionClick(option.number)}
                        disabled={isLoading}
                        className="w-full text-left p-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        style={{
                          borderColor: config.widgetPrimaryColor || "#0ea5e9",
                          color: config.widgetPrimaryColor || "#0ea5e9",
                        }}
                      >
                        <span className="font-medium">{option.number}.</span> {option.text}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-lg p-3">
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

      {/* Input Area */}
      <div className="p-4 border-t border-gray-200">
        <div className="flex space-x-2">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={config.widgetPlaceholder || "Escribe tu mensaje..."}
            disabled={isLoading}
            className="flex-1"
          />
          <Button
            onClick={sendMessage}
            disabled={!inputValue.trim() || isLoading}
            size="sm"
            style={{ backgroundColor: config.widgetPrimaryColor || "#0ea5e9" }}
            className="text-white hover:opacity-90"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Footer */}
      <div className="p-2 text-center">
        <p className="text-xs text-gray-500">Powered by Treelan</p>
      </div>
    </div>
  )
}
