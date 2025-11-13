"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Send, MessageCircle, Trash2 } from "lucide-react"
import {
  saveChatSession,
  addMessageToSession,
  clearChatSession,
  getSavedSessionId,
  loadSavedMessages,
  updateSessionThreadId,
} from "@/lib/utils/chat-storage"

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

export function WidgetChat({ clienteId, config = {}, hideHeader = false }: WidgetChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string>("")
  const [widgetConfig, setWidgetConfig] = useState<any>(null)
  const [isRestoredSession, setIsRestoredSession] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  console.log("[WIDGET-CHAT] 🚀 === COMPONENTE INICIALIZADO ===")
  console.log("[WIDGET-CHAT] 📅 Timestamp:", new Date().toISOString())
  console.log("[WIDGET-CHAT] 🆔 Cliente ID:", clienteId)

  const fetchWidgetConfig = async () => {
    try {
      console.log("[WIDGET-CHAT] 🔄 Obteniendo configuración actualizada...")

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

  const activeConfig = widgetConfig || config

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
    console.log("[WIDGET-CHAT] 🔄 useEffect de inicialización ejecutándose...")

    fetchWidgetConfig()

    const existingSessionId = getSavedSessionId(clienteId)
    const savedMessages = loadSavedMessages(clienteId)

    if (existingSessionId && savedMessages.length > 0) {
      console.log("[WIDGET-CHAT] 📂 Restaurando sesión existente:", existingSessionId)
      console.log("[WIDGET-CHAT] 💬 Mensajes guardados:", savedMessages.length)

      setSessionId(existingSessionId)
      setIsRestoredSession(true)

      const restoredMessages: Message[] = savedMessages.map((msg) => ({
        id: msg.id,
        content: msg.content,
        isUser: msg.isUser,
        timestamp: new Date(msg.timestamp),
      }))

      setMessages(restoredMessages)
    } else {
      const newSessionId = `web_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      setSessionId(newSessionId)
      console.log("[WIDGET-CHAT] 🆔 Nueva sesión creada:", newSessionId)

      saveChatSession({
        sessionId: newSessionId,
        messages: [],
        createdAt: Date.now(),
        lastAccessAt: Date.now(),
        clienteId,
      })
    }

    const configInterval = setInterval(() => {
      console.log("[WIDGET-CHAT] 🔄 Actualizando configuración periódicamente...")
      fetchWidgetConfig()
    }, 5000)

    console.log("[WIDGET-CHAT] ✅ Inicialización completada")

    return () => {
      clearInterval(configInterval)
    }
  }, [clienteId])

  useEffect(() => {
    if (defaultConfig.widgetWelcomeMessage && !isRestoredSession && messages.length === 0) {
      const welcomeMessage: Message = {
        id: "welcome",
        content: defaultConfig.widgetWelcomeMessage,
        isUser: false,
        timestamp: new Date(),
      }
      setMessages([welcomeMessage])
      addMessageToSession(clienteId, sessionId, welcomeMessage.content, false)
      console.log("[WIDGET-CHAT] 👋 Mensaje de bienvenida agregado")
    }
  }, [defaultConfig.widgetWelcomeMessage, isRestoredSession, messages.length, clienteId, sessionId])

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

    addMessageToSession(clienteId, sessionId, messageText, true)

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

        addMessageToSession(clienteId, sessionId, content.trim(), false)

        if (data.threadId) {
          updateSessionThreadId(clienteId, data.threadId)
        }
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

      addMessageToSession(clienteId, sessionId, errorMessage.content, false)
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

  const handleClearConversation = () => {
    if (confirm("¿Estás seguro de que deseas borrar esta conversación?")) {
      clearChatSession()
      const newSessionId = `web_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      setSessionId(newSessionId)
      setMessages([])
      setIsRestoredSession(false)
      saveChatSession({
        sessionId: newSessionId,
        messages: [],
        createdAt: Date.now(),
        lastAccessAt: Date.now(),
        clienteId,
      })
      console.log("[WIDGET-CHAT] 🗑️ Conversación limpiada, nueva sesión:", newSessionId)
    }
  }

  console.log("[WIDGET-CHAT] 🎨 Renderizando interfaz con", messages.length, "mensajes")

  return (
    <div className="flex flex-col h-screen bg-white">
      {!hideHeader && (
        <div className="bg-sky-600 text-white p-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-3">
            <MessageCircle className="h-6 w-6" />
            <div>
              <h3 className="font-semibold text-lg">{defaultConfig.widgetTitle}</h3>
              <p className="text-sm opacity-90">{defaultConfig.widgetSubtitle}</p>
            </div>
          </div>
          {messages.length > 0 && (
            <Button
              onClick={handleClearConversation}
              variant="ghost"
              size="sm"
              className="text-white hover:bg-sky-700"
              title="Borrar conversación"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        {isRestoredSession && messages.length > 0 && (
          <div className="flex justify-center mb-4">
            <div className="bg-sky-100 text-sky-800 px-4 py-2 rounded-full text-xs">Conversación restaurada</div>
          </div>
        )}

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

      <div className="px-4 py-2 bg-gray-50 border-t flex-shrink-0">
        <p className="text-xs text-gray-500 text-center">Powered by Treelan</p>
      </div>
    </div>
  )
}

export default WidgetChat
