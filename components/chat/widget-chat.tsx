"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Send, MessageCircle } from "lucide-react"

interface Message {
  id: string
  content: string
  isUser: boolean
  timestamp: Date
  buttons?: {
    options: string[]
    context?: string
    callback_id?: string
  }
}

interface WidgetChatProps {
  clienteId: string
  config?: any
  hideHeader?: boolean
}

export default function WidgetChat({ clienteId, config = {}, hideHeader = false }: WidgetChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string>("")

  const messagesEndRef = useRef<HTMLDivElement>(null)

  console.log("[WIDGET-CHAT] 🚀 === COMPONENTE INICIALIZADO ===")
  console.log("[WIDGET-CHAT] 📅 Timestamp:", new Date().toISOString())
  console.log("[WIDGET-CHAT] 🆔 Cliente ID:", clienteId)

  // Configuración por defecto
  const defaultConfig = {
    widgetTitle: "Asistente Virtual",
    widgetSubtitle: "Instituto Oftalmológico Saravia Olmos",
    widgetWelcomeMessage:
      "¡Hola! Soy el asistente virtual del Instituto Oftalmológico Saravia Olmos. ¿En qué puedo ayudarte hoy?",
    widgetPlaceholder: "Escribe tu mensaje...",
    widgetPrimaryColor: "#16a34a",
    widgetSecondaryColor: "#f0fdf4",
    ...config,
  }

  console.log("[WIDGET-CHAT] 📋 Configuración final:", defaultConfig)

  // Inicialización
  useEffect(() => {
    console.log("[WIDGET-CHAT] 🔄 useEffect de inicialización ejecutándose...")

    // Generar session_id único
    const newSessionId = `web_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    setSessionId(newSessionId)
    console.log("[WIDGET-CHAT] 🆔 Session ID generado:", newSessionId)

    // Agregar mensaje de bienvenida
    if (defaultConfig.widgetWelcomeMessage) {
      const welcomeMessage: Message = {
        id: "welcome",
        content: defaultConfig.widgetWelcomeMessage,
        isUser: false,
        timestamp: new Date(),
      }
      setMessages([welcomeMessage])
      console.log("[WIDGET-CHAT] 👋 Mensaje de bienvenida agregado:", welcomeMessage)
    }

    console.log("[WIDGET-CHAT] ✅ Inicialización completada")
  }, [clienteId])

  // Auto-scroll
  useEffect(() => {
    if (messagesEndRef.current) {
      console.log("[WIDGET-CHAT] 📜 Haciendo scroll automático")
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages])

  const sendMessage = async (text?: string) => {
    const messageText = text || inputValue.trim()
    if (!messageText || isLoading || !sessionId) {
      console.log("[WIDGET-CHAT] ⚠️ Condiciones no cumplidas:", {
        messageText: !!messageText,
        isLoading,
        sessionId: !!sessionId,
      })
      return
    }

    console.log("[WIDGET-CHAT] 📤 === ENVIANDO MENSAJE ===")
    console.log("[WIDGET-CHAT] 📝 Texto:", messageText)
    console.log("[WIDGET-CHAT] 🆔 Cliente ID:", clienteId)
    console.log("[WIDGET-CHAT] 🔗 Session ID:", sessionId)

    const userMessage: Message = {
      id: Date.now().toString(),
      content: messageText,
      isUser: true,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    if (!text) setInputValue("")
    setIsLoading(true)

    try {
      const requestBody = {
        message: messageText,
        cliente_id: clienteId,
        session_id: sessionId,
        source: "widget",
      }

      console.log("[WIDGET-CHAT] 🌐 Enviando petición a /api/chat:")
      console.log("[WIDGET-CHAT] 📦 Body:", JSON.stringify(requestBody, null, 2))

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      })

      console.log("[WIDGET-CHAT] 📡 Respuesta recibida:")
      console.log("[WIDGET-CHAT] - Status:", response.status)
      console.log("[WIDGET-CHAT] - Status Text:", response.statusText)
      console.log("[WIDGET-CHAT] - OK:", response.ok)

      if (!response.ok) {
        const errorText = await response.text()
        console.error("[WIDGET-CHAT] ❌ Error response body:", errorText)
        throw new Error(`Error ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      console.log("[WIDGET-CHAT] 📋 Datos JSON recibidos:", JSON.stringify(data, null, 2))

      if (data.success && data.response) {
        let content = data.response
        let buttons = null

        console.log("[WIDGET-CHAT] 🔍 Procesando respuesta...")
        console.log("[WIDGET-CHAT] 📄 Contenido original:", content)

        // Buscar botones en la respuesta
        const widgetButtonsMatch = content.match(/__WIDGET_BUTTONS__(.+?)__END_BUTTONS__/s)
        if (widgetButtonsMatch) {
          console.log("[WIDGET-CHAT] 🔘 Marcador de botones encontrado:", widgetButtonsMatch[1])
          try {
            const buttonData = JSON.parse(widgetButtonsMatch[1])
            content = content.replace(widgetButtonsMatch[0], "").trim()
            buttons = {
              options: buttonData.opciones || [],
              context: buttonData.contexto || "",
              callback_id: buttonData.callback_id || "default_callback",
            }
            console.log("[WIDGET-CHAT] ✅ Botones extraídos:", buttons)
          } catch (e) {
            console.error("[WIDGET-CHAT] ❌ Error parseando botones:", e)
          }
        }

        const botMessage: Message = {
          id: (Date.now() + 1).toString(),
          content: content.trim(),
          isUser: false,
          timestamp: new Date(),
          buttons: buttons,
        }

        console.log("[WIDGET-CHAT] 🤖 Agregando mensaje del bot:", botMessage)
        setMessages((prev) => [...prev, botMessage])
      } else {
        console.error("[WIDGET-CHAT] ❌ Respuesta inválida:", data)
        throw new Error(data.error || "Error desconocido en la respuesta")
      }
    } catch (error) {
      console.error("[WIDGET-CHAT] 💥 Error completo:", error)
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: "Lo siento, ha ocurrido un error. Por favor, intenta nuevamente.",
        isUser: false,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
      console.log("[WIDGET-CHAT] ✅ Proceso de envío completado")
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      console.log("[WIDGET-CHAT] ⌨️ Enter presionado")
      sendMessage()
    }
  }

  const handleButtonClick = (option: string) => {
    console.log("[WIDGET-CHAT] 🔘 Botón clickeado:", option)
    sendMessage(option)
  }

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  console.log("[WIDGET-CHAT] 🎨 Renderizando interfaz con", messages.length, "mensajes")

  return (
    <div className="flex flex-col h-full bg-white shadow-lg rounded-lg overflow-hidden">
      {/* Header */}
      {!hideHeader && (
        <div className="px-4 py-3 bg-blue-600 text-white">
          <div className="flex items-center space-x-3">
            <MessageCircle className="h-6 w-6" />
            <div>
              <h3 className="font-semibold text-base">{defaultConfig.widgetTitle}</h3>
              <p className="text-sm opacity-90">{defaultConfig.widgetSubtitle}</p>
            </div>
          </div>
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.isUser ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] ${message.isUser ? "order-2" : "order-1"}`}>
              <div
                className={`rounded-2xl px-4 py-2 ${
                  message.isUser
                    ? "bg-blue-600 text-white rounded-br-md"
                    : "bg-white text-gray-800 rounded-bl-md shadow-sm border"
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{message.content}</p>

                {/* Botones interactivos */}
                {message.buttons && message.buttons.options.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {message.buttons.context && (
                      <p className="text-xs font-medium text-gray-600 mb-2">{message.buttons.context}</p>
                    )}
                    <div className="grid gap-2">
                      {message.buttons.options.map((option, index) => (
                        <button
                          key={index}
                          onClick={() => handleButtonClick(option)}
                          className="text-left text-sm py-2 px-3 rounded-lg border-2 border-blue-600 bg-white text-blue-600 hover:bg-blue-50 transition-all duration-200 shadow-sm hover:shadow-md"
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <p
                className={`text-xs mt-1 px-1 ${message.isUser ? "text-right text-gray-500" : "text-left text-gray-500"}`}
              >
                {formatTime(message.timestamp)}
              </p>
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white rounded-2xl rounded-bl-md px-4 py-3 shadow-sm border">
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
      <div className="p-4 bg-white border-t">
        <div className="flex space-x-2">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={defaultConfig.widgetPlaceholder}
            disabled={isLoading}
            className="flex-1 rounded-full border-gray-300 focus:border-blue-500 focus:ring-blue-500"
          />
          <Button
            onClick={() => sendMessage()}
            disabled={!inputValue.trim() || isLoading}
            className="rounded-full bg-blue-600 hover:bg-blue-700 text-white px-4"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 bg-gray-50 border-t">
        <p className="text-xs text-gray-500 text-center">Powered by Treelan</p>
      </div>
    </div>
  )
}
