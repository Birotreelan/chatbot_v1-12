"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Send } from "lucide-react"

// First, update the Message interface to include a property for options
interface Message {
  id: string
  content: string
  isUser: boolean
  timestamp: Date
  options?: Array<{
    number: string
    text: string
  }>
}

// Add a function to parse options from message content
// Add this function before the WidgetChat component
function parseOptionsFromMessage(content: string): {
  textBeforeOptions: string
  options: Array<{ number: string; text: string }>
  textAfterOptions: string
} {
  // Regular expression to match numbered options like "1. Option text"
  const optionRegex = /(\d+)\.\s+([^\n]+)/g
  const matches = Array.from(content.matchAll(optionRegex))

  if (matches.length === 0) {
    return {
      textBeforeOptions: content,
      options: [],
      textAfterOptions: "",
    }
  }

  // Find the position of the first and last option
  const firstOptionIndex = matches[0].index || 0
  const lastOption = matches[matches.length - 1]
  const lastOptionEndIndex = (lastOption.index || 0) + lastOption[0].length

  // Extract text before options, options themselves, and text after options
  const textBeforeOptions = content.substring(0, firstOptionIndex).trim()
  const textAfterOptions = content.substring(lastOptionEndIndex).trim()

  // Extract options
  const options = matches.map((match) => ({
    number: match[1],
    text: match[2].trim(),
  }))

  return {
    textBeforeOptions,
    options,
    textAfterOptions,
  }
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

  // Update the sendMessage function to process options when receiving a message
  const sendMessage = async (optionText?: string) => {
    if ((!inputValue.trim() && !optionText) || isLoading || !sessionId) return

    const messageContent = optionText || inputValue.trim()

    const userMessage: Message = {
      id: Date.now().toString(),
      content: messageContent,
      isUser: true,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInputValue("")
    setIsLoading(true)

    try {
      console.log("[WIDGET-CHAT] Enviando mensaje:", {
        message: messageContent,
        cliente_id: clienteId,
        session_id: sessionId,
      })

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: messageContent,
          cliente_id: clienteId,
          session_id: sessionId,
        }),
      })

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()

      if (data.success && data.response) {
        // Parse options from the response
        const { textBeforeOptions, options, textAfterOptions } = parseOptionsFromMessage(data.response)

        const botMessage: Message = {
          id: (Date.now() + 1).toString(),
          content: data.response,
          isUser: false,
          timestamp: new Date(),
          options: options.length > 0 ? options : undefined,
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

  // Add a function to handle option selection
  const handleOptionClick = (option: { number: string; text: string }) => {
    sendMessage(option.number)
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
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.isUser ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-lg p-3 ${message.isUser ? "text-white" : "bg-gray-100 text-gray-800"}`}
              style={{
                backgroundColor: message.isUser ? config.widgetPrimaryColor || "#0ea5e9" : undefined,
              }}
            >
              {message.isUser ? (
                <p className="text-sm whitespace-pre-wrap text-left">{message.content}</p>
              ) : (
                <>
                  {message.options && message.options.length > 0 ? (
                    <div className="text-sm whitespace-pre-wrap text-left">
                      {/* Parse and render the message with options as buttons */}
                      {(() => {
                        const { textBeforeOptions, options, textAfterOptions } = parseOptionsFromMessage(
                          message.content,
                        )
                        return (
                          <>
                            <p>{textBeforeOptions}</p>
                            <div className="flex flex-col space-y-2 my-2">
                              {options.map((option, index) => (
                                <button
                                  key={index}
                                  onClick={() => handleOptionClick(option)}
                                  className="text-left px-3 py-2 rounded border border-gray-300 hover:bg-gray-200 transition-colors"
                                  style={{ borderColor: config.widgetSecondaryColor || "#cbd5e1" }}
                                >
                                  {option.number}. {option.text}
                                </button>
                              ))}
                            </div>
                            {textAfterOptions && <p>{textAfterOptions}</p>}
                          </>
                        )
                      })()}
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap text-left">{message.content}</p>
                  )}
                </>
              )}
              <p className={`text-xs mt-1 ${message.isUser ? "text-white/70" : "text-gray-500"}`}>
                {formatTime(message.timestamp)}
              </p>
            </div>
          </div>
        ))}

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
