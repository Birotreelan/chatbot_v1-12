"use client"

import type React from "react"
import { useState, useEffect, useRef, useCallback } from "react"
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
  const [initialized, setInitialized] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  console.log("[WIDGET-CHAT] 🔄 Render con clienteId:", clienteId, "initialized:", initialized)

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

  // Efecto de inicialización (solo una vez)
  useEffect(() => {
    if (initialized) {
      console.log("[WIDGET-CHAT] ⚠️ Ya inicializado, saltando...")
      return
    }

    console.log("[WIDGET-CHAT] 🔄 Inicializando por primera vez...")

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
    setInitialized(true)
    console.log("[WIDGET-CHAT] ✅ Inicialización completada")
  }, [clienteId, initialized])

  // Scroll automático
  useEffect(() => {
    if (mounted && messagesEndRef.current && messages.length > 0) {
      console.log("[WIDGET-CHAT] 📜 Haciendo scroll automático")
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages, mounted])

  const sendMessage = useCallback(
    async (text?: string) => {
      if (!mounted || !initialized) {
        console.log("[WIDGET-CHAT] ⚠️ Componente no listo, cancelando envío")
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
    },
    [mounted, initialized, inputValue, isLoading, sessionId, clienteId],
  )

  const handleKeyPress = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        console.log("[WIDGET-CHAT] ⌨️ Enter presionado, enviando mensaje")
        sendMessage()
      }
    },
    [sendMessage],
  )

  const handleButtonClick = useCallback(
    (option: string) => {
      console.log("[WIDGET-CHAT] 🔘 Botón clickeado:", option)
      sendMessage(option)
    },
    [sendMessage],
  )

  const handleSubmit = useCallback(() => {
    console.log("[WIDGET-CHAT] 📤 Submit button clicked")
    sendMessage()
  }, [sendMessage])

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  // Loading state
  if (!mounted || !initialized) {
    console.log("[WIDGET-CHAT] ⏳ Mostrando loading state")
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          backgroundColor: "#f9fafb",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: "32px",
              height: "32px",
              border: "2px solid #e5e7eb",
              borderTop: "2px solid #16a34a",
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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        backgroundColor: "white",
        fontFamily: "system-ui, -apple-system, sans-serif",
        border: "none",
        margin: 0,
        padding: 0,
      }}
    >
      {/* Header */}
      {!hideHeader && (
        <div
          style={{
            padding: "16px",
            color: "white",
            backgroundColor: defaultConfig.widgetPrimaryColor,
            borderTopLeftRadius: "12px",
            borderTopRightRadius: "12px",
          }}
        >
          <div style={{ textAlign: "left" }}>
            <h3 style={{ fontSize: "18px", fontWeight: "600", margin: "0 0 4px 0" }}>{defaultConfig.widgetTitle}</h3>
            <p style={{ fontSize: "14px", opacity: 0.9, margin: 0 }}>{defaultConfig.widgetSubtitle}</p>
          </div>
        </div>
      )}

      {/* Messages Area */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px",
          backgroundColor: "#f9fafb",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        {messages.map((message) => (
          <div
            key={message.id}
            style={{
              display: "flex",
              justifyContent: message.isUser ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={{
                maxWidth: "80%",
                padding: "12px",
                borderRadius: "12px",
                backgroundColor: message.isUser ? defaultConfig.widgetPrimaryColor : "white",
                color: message.isUser ? "white" : "#374151",
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
                border: message.isUser ? "none" : "1px solid #e5e7eb",
              }}
            >
              <p
                style={{
                  fontSize: "14px",
                  lineHeight: "1.5",
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  textAlign: "left",
                }}
              >
                {message.content}
              </p>

              {/* Botones interactivos */}
              {message.buttons && message.buttons.options.length > 0 && (
                <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  {message.buttons.context && (
                    <p
                      style={{
                        fontSize: "12px",
                        fontWeight: "500",
                        margin: "0 0 8px 0",
                        color: "#6b7280",
                      }}
                    >
                      {message.buttons.context}
                    </p>
                  )}
                  {message.buttons.options.map((option, index) => (
                    <button
                      key={index}
                      onClick={() => handleButtonClick(option)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        fontSize: "14px",
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: `2px solid ${defaultConfig.widgetPrimaryColor}`,
                        backgroundColor: "white",
                        color: defaultConfig.widgetPrimaryColor,
                        cursor: "pointer",
                        transition: "all 0.2s",
                        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = "#f9fafb"
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = "white"
                      }}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}

              <p
                style={{
                  fontSize: "12px",
                  marginTop: "8px",
                  margin: "8px 0 0 0",
                  opacity: message.isUser ? 0.7 : 0.6,
                  color: message.isUser ? "white" : "#6b7280",
                }}
              >
                {formatTime(message.timestamp)}
              </p>
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div
              style={{
                backgroundColor: "white",
                borderRadius: "12px",
                padding: "12px",
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
                border: "1px solid #e5e7eb",
              }}
            >
              <div style={{ display: "flex", gap: "4px" }}>
                <div
                  style={{
                    width: "8px",
                    height: "8px",
                    backgroundColor: "#9ca3af",
                    borderRadius: "50%",
                    animation: "bounce 1.4s infinite ease-in-out both",
                  }}
                ></div>
                <div
                  style={{
                    width: "8px",
                    height: "8px",
                    backgroundColor: "#9ca3af",
                    borderRadius: "50%",
                    animation: "bounce 1.4s infinite ease-in-out both",
                    animationDelay: "0.16s",
                  }}
                ></div>
                <div
                  style={{
                    width: "8px",
                    height: "8px",
                    backgroundColor: "#9ca3af",
                    borderRadius: "50%",
                    animation: "bounce 1.4s infinite ease-in-out both",
                    animationDelay: "0.32s",
                  }}
                ></div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div
        style={{
          padding: "16px",
          backgroundColor: "white",
          borderTop: "1px solid #e5e7eb",
          borderBottomLeftRadius: "12px",
          borderBottomRightRadius: "12px",
        }}
      >
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={defaultConfig.widgetPlaceholder}
            disabled={isLoading}
            style={{
              flex: 1,
              padding: "12px",
              border: "1px solid #d1d5db",
              borderRadius: "24px",
              fontSize: "14px",
              outline: "none",
              fontFamily: "inherit",
            }}
            onFocus={(e) => {
              e.target.style.borderColor = defaultConfig.widgetPrimaryColor
              e.target.style.boxShadow = `0 0 0 3px ${defaultConfig.widgetPrimaryColor}20`
            }}
            onBlur={(e) => {
              e.target.style.borderColor = "#d1d5db"
              e.target.style.boxShadow = "none"
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={!inputValue.trim() || isLoading}
            style={{
              padding: "12px",
              backgroundColor: defaultConfig.widgetPrimaryColor,
              color: "white",
              border: "none",
              borderRadius: "50%",
              cursor: inputValue.trim() && !isLoading ? "pointer" : "not-allowed",
              opacity: inputValue.trim() && !isLoading ? 1 : 0.5,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "48px",
              height: "48px",
              transition: "opacity 0.2s",
            }}
          >
            <Send size={20} />
          </button>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "8px",
          textAlign: "center",
          backgroundColor: "#f9fafb",
          borderTop: "1px solid #e5e7eb",
        }}
      >
        <p style={{ fontSize: "12px", color: "#6b7280", margin: 0 }}>Powered by Treelan</p>
      </div>

      {/* CSS Animations */}
      <style jsx>{`
        @keyframes spin {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }
        @keyframes bounce {
          0%,
          80%,
          100% {
            transform: scale(0);
          }
          40% {
            transform: scale(1);
          }
        }
      `}</style>
    </div>
  )
}
