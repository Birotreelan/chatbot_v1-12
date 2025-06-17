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
  buttons?: {
    options: string[]
    context?: string
    callback_id?: string
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
  hideHeader?: boolean
}

export default function WidgetChat({ clienteId, config, hideHeader = false }: WidgetChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string>("")
  const [mounted, setMounted] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  console.log("[WIDGET-CHAT] 🔄 Componente inicializándose con clienteId:", clienteId)

  // Configuración por defecto (igual que en el dashboard)
  const defaultConfig = {
    widgetTitle: "Asistente Virtual",
    widgetSubtitle: "Instituto Oftalmológico Saravia Olmos",
    widgetWelcomeMessage:
      "¡Hola! Soy el asistente virtual del Instituto Oftalmológico Saravia Olmos. ¿En qué puedo ayudarte hoy?",
    widgetPlaceholder: "Escribe tu mensaje...",
    widgetPrimaryColor: "#0ea5e9",
    widgetSecondaryColor: "#f0f9ff",
    ...config,
  }

  console.log("[WIDGET-CHAT] 📋 Configuración aplicada:", defaultConfig)

  // Efecto de montaje
  useEffect(() => {
    console.log("[WIDGET-CHAT] 🔄 Efecto de montaje ejecutándose...")

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
      console.log("[WIDGET-CHAT] 👋 Mensaje de bienvenida agregado")
    }

    setMounted(true)
    console.log("[WIDGET-CHAT] ✅ Componente montado correctamente")
  }, [])

  // Scroll automático
  useEffect(() => {
    if (mounted && messagesEndRef.current) {
      console.log("[WIDGET-CHAT] 📜 Haciendo scroll automático")
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages, mounted])

  const sendMessage = async (text?: string) => {
    if (!mounted) {
      console.log("[WIDGET-CHAT] ⚠️ Componente no montado, cancelando envío")
      return
    }

    const messageText = text || inputValue.trim()
    if (!messageText || isLoading || !sessionId) {
      console.log("[WIDGET-CHAT] ⚠️ Condiciones no cumplidas para envío:", {
        messageText: !!messageText,
        isLoading,
        sessionId: !!sessionId,
      })
      return
    }

    console.log("[WIDGET-CHAT] 📤 Enviando mensaje:", messageText)

    const userMessage: Message = {
      id: Date.now().toString(),
      content: messageText,
      isUser: true,
      timestamp: new Date(),
    }

    setMessages((prev) => {
      console.log("[WIDGET-CHAT] 📝 Agregando mensaje del usuario")
      return [...prev, userMessage]
    })

    if (!text) setInputValue("")
    setIsLoading(true)

    try {
      console.log("[WIDGET-CHAT] 🌐 Haciendo petición a /api/chat con:", {
        message: messageText,
        cliente_id: clienteId,
        session_id: sessionId,
        source: "widget",
      })

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: messageText,
          cliente_id: clienteId,
          session_id: sessionId,
          source: "widget",
        }),
      })

      console.log("[WIDGET-CHAT] 📡 Respuesta del servidor:", {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
      })

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      console.log("[WIDGET-CHAT] 📋 Datos completos recibidos:", data)

      if (data.success && data.response) {
        let content = data.response
        let buttons = null

        console.log("[WIDGET-CHAT] 🔍 Analizando respuesta para botones...")
        console.log("[WIDGET-CHAT] 📄 Contenido original:", content)

        // Buscar botones en la respuesta
        const widgetButtonsMatch = content.match(/__WIDGET_BUTTONS__(.+?)__END_BUTTONS__/s)
        if (widgetButtonsMatch) {
          console.log("[WIDGET-CHAT] 🔘 Marcador de botones encontrado")
          try {
            const buttonData = JSON.parse(widgetButtonsMatch[1])
            content = content.replace(widgetButtonsMatch[0], "").trim()
            buttons = {
              options: buttonData.opciones,
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

        console.log("[WIDGET-CHAT] 🤖 Mensaje del bot a agregar:", {
          content: botMessage.content,
          hasButtons: !!botMessage.buttons,
          buttonsCount: botMessage.buttons?.options?.length || 0,
        })

        setMessages((prev) => {
          console.log("[WIDGET-CHAT] 📝 Agregando mensaje del bot")
          return [...prev, botMessage]
        })
      } else {
        throw new Error(data.error || "Error desconocido en la respuesta")
      }
    } catch (error) {
      console.error("[WIDGET-CHAT] ❌ Error enviando mensaje:", error)
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
      console.log("[WIDGET-CHAT] ⌨️ Enter presionado, enviando mensaje")
      sendMessage()
    }
  }

  const handleButtonClick = (option: string) => {
    console.log("[WIDGET-CHAT] 🔘 Botón clickeado:", option)
    sendMessage(option)
  }

  const handleSubmit = () => {
    console.log("[WIDGET-CHAT] 📤 Submit button clicked")
    sendMessage()
  }

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  // Loading state
  if (!mounted) {
    console.log("[WIDGET-CHAT] ⏳ Mostrando loading state")
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          backgroundColor: "#f9fafb",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: "32px",
              height: "32px",
              border: "2px solid #e5e7eb",
              borderTop: "2px solid #0ea5e9",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
              margin: "0 auto 16px",
            }}
          ></div>
          <p style={{ color: "#6b7280", fontSize: "14px" }}>Cargando chat...</p>
        </div>
      </div>
    )
  }

  console.log("[WIDGET-CHAT] 🎨 Renderizando interfaz completa")

  return (
    <div className="flex flex-col h-full bg-white" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* Header */}
      {!hideHeader && (
        <div className="p-4 text-white" style={{ backgroundColor: defaultConfig.widgetPrimaryColor }}>
          <div className="text-left">
            <h3 className="font-semibold text-lg">{defaultConfig.widgetTitle}</h3>
            <p className="text-sm opacity-90">{defaultConfig.widgetSubtitle}</p>
          </div>
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ maxHeight: "calc(100% - 140px)" }}>
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.isUser ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-lg p-3 ${message.isUser ? "text-white" : "bg-gray-100 text-gray-800"}`}
              style={{
                backgroundColor: message.isUser ? defaultConfig.widgetPrimaryColor : undefined,
              }}
            >
              <p className="text-sm whitespace-pre-wrap text-left">{message.content}</p>

              {/* Botones interactivos */}
              {message.buttons && message.buttons.options.length > 0 && (
                <div className="mt-3 space-y-2">
                  {message.buttons.context && (
                    <p className="text-xs font-medium mb-2 text-gray-600">{message.buttons.context}</p>
                  )}
                  {message.buttons.options.map((option, index) => (
                    <button
                      key={index}
                      onClick={() => handleButtonClick(option)}
                      className="w-full text-left text-sm py-2 px-3 rounded-md border bg-white hover:bg-gray-50 transition-colors shadow-sm"
                      style={{
                        borderColor: defaultConfig.widgetPrimaryColor,
                        color: defaultConfig.widgetPrimaryColor,
                      }}
                    >
                      {option}
                    </button>
                  ))}
                </div>
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
            placeholder={defaultConfig.widgetPlaceholder}
            disabled={isLoading}
            className="flex-1"
          />
          <Button
            onClick={handleSubmit}
            disabled={!inputValue.trim() || isLoading}
            size="sm"
            style={{ backgroundColor: defaultConfig.widgetPrimaryColor }}
            className="text-white hover:opacity-90"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Footer */}
      <div className="p-2 text-center border-t">
        <p className="text-xs text-gray-500">Powered by Treelan</p>
      </div>
    </div>
  )
}
