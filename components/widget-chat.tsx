"use client"

import type React from "react"

import { useState, useEffect, useRef, Suspense } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Send, MessageCircle } from "lucide-react"

interface Message {
  id: string
  content: string
  isUser: boolean
  timestamp: Date
}

interface WidgetChatProps {
  clienteId: string
  config?: any
  hideHeader?: boolean
}

function WidgetChatContent({ clienteId, config = {}, hideHeader = false }: WidgetChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string>("")
  const [widgetConfig, setWidgetConfig] = useState<any>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  console.log("[WIDGET-CHAT] 🚀 === COMPONENTE INICIALIZADO ===")
  console.log("[WIDGET-CHAT] 📅 Timestamp:", new Date().toISOString())
  console.log("[WIDGET-CHAT] 🆔 Cliente ID:", clienteId)

  const fetchWidgetConfig = async () => {
    try {
      console.log("[WIDGET-CHAT] 🔄 Obteniendo configuración actualizada...")

      // Agregar timestamp para evitar caché
      const timestamp = Date.now()
      const url = `/api/widget?cliente_id=${encodeURIComponent(clienteId)}&_t=${timestamp}`

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      })

      if (response.ok) {
        const fetchedConfig = await response.json()
        console.log("[WIDGET-CHAT] ✅ Configuración obtenida:", fetchedConfig)
        setWidgetConfig(fetchedConfig)
        return fetchedConfig
      } else {
        console.warn("[WIDGET-CHAT] ⚠️ No se pudo obtener la configuración:", response.status)
        return null
      }
    } catch (error) {
      console.error("[WIDGET-CHAT] ❌ Error obteniendo configuración:", error)
      return null
    }
  }

  // Usar la configuración obtenida o la pasada por props
  const activeConfig = widgetConfig || config

  // Configuración por defecto - usar los valores del config activo
  const defaultConfig = {
    widgetTitle: activeConfig?.widgetTitle || "Asistente Virtual",
    widgetSubtitle: activeConfig?.widgetSubtitle || "Estamos aquí para ayudarte",
    widgetWelcomeMessage: activeConfig?.widgetWelcomeMessage || "¡Hola! ¿En qué puedo ayudarte hoy?",
    widgetPlaceholder: activeConfig?.widgetPlaceholder || "Escribe tu mensaje...",
    widgetPrimaryColor: activeConfig?.widgetPrimaryColor || "#0ea5e9",
    widgetSecondaryColor: activeConfig?.widgetSecondaryColor || "#f0f9ff",
  }

  console.log("[WIDGET-CHAT] 📋 Config recibido por props:", config)
  console.log("[WIDGET-CHAT] 📋 Config obtenido de API:", widgetConfig)
  console.log("[WIDGET-CHAT] 📋 Configuración final:", defaultConfig)

  useEffect(() => {
    let isMounted = true
    console.log("[WIDGET-CHAT] 🔄 useEffect de inicialización ejecutándose...")

    // Obtener configuración actualizada
    const initializeConfig = async () => {
      if (isMounted) {
        await fetchWidgetConfig()
      }
    }

    initializeConfig()

    // Generar session_id único
    const newSessionId = `web_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    if (isMounted) {
      setSessionId(newSessionId)
      console.log("[WIDGET-CHAT] 🆔 Session ID generado:", newSessionId)
    }

    console.log("[WIDGET-CHAT] ✅ Inicialización completada")

    return () => {
      isMounted = false
    }
  }, [clienteId])

  // Agregar mensaje de bienvenida cuando la configuración esté lista
  useEffect(() => {
    if (defaultConfig.widgetWelcomeMessage) {
      // Limpiar mensajes anteriores y agregar el nuevo mensaje de bienvenida
      const welcomeMessage: Message = {
        id: "welcome",
        content: defaultConfig.widgetWelcomeMessage,
        isUser: false,
        timestamp: new Date(),
      }
      setMessages([welcomeMessage])
      console.log("[WIDGET-CHAT] 👋 Mensaje de bienvenida actualizado:", welcomeMessage)
    }
  }, [defaultConfig.widgetWelcomeMessage])

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
        const content = data.response

        console.log("[WIDGET-CHAT] 🔍 Procesando respuesta...")
        console.log("[WIDGET-CHAT] 📄 Contenido original:", content)

        const botMessage: Message = {
          id: (Date.now() + 1).toString(),
          content: content.trim(),
          isUser: false,
          timestamp: new Date(),
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

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  console.log("[WIDGET-CHAT] 🎨 Renderizando interfaz con", messages.length, "mensajes")

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header */}
      {!hideHeader && (
        <div className="bg-sky-600 text-white p-4 flex items-center space-x-3 flex-shrink-0">
          <MessageCircle className="h-6 w-6" />
          <div>
            <h3 className="font-semibold text-lg">{defaultConfig.widgetTitle}</h3>
            <p className="text-sm opacity-90">{defaultConfig.widgetSubtitle}</p>
          </div>
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.isUser ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] ${message.isUser ? "order-2" : "order-1"}`}>
              <div
                className={`rounded-2xl px-4 py-3 ${
                  message.isUser
                    ? "bg-sky-600 text-white rounded-br-md"
                    : "bg-white text-gray-800 rounded-bl-md shadow-sm border"
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{message.content}</p>
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
      <div className="p-4 bg-white border-t flex-shrink-0">
        <div className="flex space-x-2">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={defaultConfig.widgetPlaceholder}
            disabled={isLoading}
            className="flex-1 rounded-full border-gray-300 focus:border-sky-500 focus:ring-sky-500"
          />
          <Button
            onClick={() => sendMessage()}
            disabled={!inputValue.trim() || isLoading}
            className="rounded-full bg-sky-600 hover:bg-sky-700 text-white px-4"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 bg-gray-50 border-t flex-shrink-0">
        <p className="text-xs text-gray-500 text-center">Powered by Treelan</p>
      </div>
    </div>
  )
}

export function WidgetChat(props: WidgetChatProps) {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen">Cargando chat...</div>}>
      <WidgetChatContent {...props} />
    </Suspense>
  )
}

export default WidgetChat
