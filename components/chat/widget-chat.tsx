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

  const sendMessage = async (text?: string) => {
    const messageText = text || inputValue.trim()
    if (!messageText || isLoading || !sessionId) return

    const userMessage: Message = {
      id: Date.now().toString(),
      content: messageText,
      isUser: true,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    if (!text) setInputValue("") // Solo limpiar input si no es un botón
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
          message: messageText,
          cliente_id: clienteId,
          session_id: sessionId,
        }),
      })

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      console.log("[WIDGET-CHAT] Respuesta completa del servidor:", data)

      if (data.success && data.response) {
        let content = data.response
        let buttons = null

        console.log("[WIDGET-CHAT] Analizando respuesta para botones...")
        console.log("[WIDGET-CHAT] Contenido de la respuesta:", content)

        // Método 1: Buscar el patrón de función de botones
        const buttonMatch =
          data.response.match(/Ejecutar función: crear_botones_opciones\$\$\{(.*?)\}\$\$/s) ||
          data.response.match(/crear_botones_opciones\$\$\{(.*?)\}\$\$/s)

        if (buttonMatch) {
          console.log("[WIDGET-CHAT] ✅ Patrón de función encontrado:", buttonMatch[0])
          try {
            const jsonStr = buttonMatch[1]
            const cleanJsonStr = jsonStr.replace(/\{\{/g, "{").replace(/\}\}/g, "}")
            const buttonData = JSON.parse(cleanJsonStr)

            content = data.response.replace(buttonMatch[0], "")
            buttons = {
              options: buttonData.opciones,
              context: buttonData.contexto,
              callback_id: buttonData.callback_id,
            }

            console.log("[WIDGET-CHAT] ✅ Botones extraídos del patrón:", buttons)
          } catch (e) {
            console.error("[WIDGET-CHAT] ❌ Error al parsear botones del patrón:", e)
          }
        }

        // Método 2: Detección basada en contenido de texto común
        if (!buttons) {
          console.log("[WIDGET-CHAT] 🔍 Buscando opciones en el texto...")

          // Buscar frases que indican opciones
          const optionIndicators = [
            "Por favor, elegí una de estas opciones:",
            "Por favor, elegi una de estas opciones:",
            "Por favor, elige una de estas opciones:",
            "Selecciona una opción:",
            "¿Cómo deseas solicitar tu turno?",
            "Podés también indicar preferencias",
          ]

          const lines = content.split("\n")
          let optionsStartIndex = -1

          // Buscar el índice donde empiezan las opciones
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].toLowerCase()
            if (optionIndicators.some((indicator) => line.includes(indicator.toLowerCase()))) {
              optionsStartIndex = i
              break
            }
          }

          if (optionsStartIndex !== -1) {
            console.log("[WIDGET-CHAT] 📍 Indicador de opciones encontrado en línea:", optionsStartIndex)

            // Extraer opciones que siguen al indicador
            const options = []
            for (let i = optionsStartIndex + 1; i < lines.length; i++) {
              const line = lines[i].trim()

              // Buscar líneas que parecen opciones (empiezan con -, •, número, etc.)
              if (/^\s*[-•\d]\s+/.test(line) && line.length > 3) {
                const cleanOption = line.replace(/^\s*[-•\d]+\s*/, "").trim()
                if (cleanOption.length > 0) {
                  options.push(cleanOption)
                }
              }
              // Si encontramos una línea vacía o que no parece opción, paramos
              else if (line.length === 0 || (!line.startsWith("-") && !line.startsWith("•") && !/^\d/.test(line))) {
                break
              }
            }

            if (options.length > 0) {
              console.log("[WIDGET-CHAT] ✅ Opciones extraídas del texto:", options)
              buttons = {
                options: options,
                context: "Selecciona una opción:",
                callback_id: "text_options",
              }
            }
          }

          // Método 3: Buscar opciones específicas conocidas
          if (!buttons) {
            const knownOptions = [
              "Con un médico oftalmólogo en particular",
              "Por especialidad",
              "Consulta general con cualquier oftalmólogo",
            ]

            const foundOptions = knownOptions.filter((option) => content.toLowerCase().includes(option.toLowerCase()))

            if (foundOptions.length >= 2) {
              console.log("[WIDGET-CHAT] ✅ Opciones conocidas encontradas:", foundOptions)
              buttons = {
                options: foundOptions,
                context: "Selecciona una opción:",
                callback_id: "known_options",
              }
            }
          }
        }

        const botMessage: Message = {
          id: (Date.now() + 1).toString(),
          content: content.trim(),
          isUser: false,
          timestamp: new Date(),
          buttons: buttons,
        }

        console.log("[WIDGET-CHAT] 📨 Mensaje final a mostrar:", {
          content: botMessage.content,
          hasButtons: !!botMessage.buttons,
          buttons: botMessage.buttons,
        })

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
      handleSubmit()
    }
  }

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const handleButtonClick = (option: string) => {
    console.log("[WIDGET-CHAT] 🔘 Opción seleccionada:", option)
    sendMessage(option)
  }

  const handleSubmit = () => {
    sendMessage()
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
              <p className="text-sm whitespace-pre-wrap text-left">{message.content}</p>

              {/* Botones interactivos si existen */}
              {message.buttons && message.buttons.options.length > 0 && (
                <div className="mt-3 space-y-2">
                  {message.buttons.context && (
                    <p className="text-xs font-medium mb-2 text-gray-600">{message.buttons.context}</p>
                  )}
                  {message.buttons.options.map((option, index) => (
                    <button
                      key={index}
                      onClick={() => handleButtonClick(option)}
                      className="w-full text-left text-sm py-2 px-3 rounded-md border border-gray-300 bg-white hover:bg-gray-50 transition-colors shadow-sm"
                      style={{
                        borderColor: config.widgetPrimaryColor || "#0ea5e9",
                        color: config.widgetPrimaryColor || "#0ea5e9",
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
            placeholder={config.widgetPlaceholder || "Escribe tu mensaje..."}
            disabled={isLoading}
            className="flex-1"
          />
          <Button
            onClick={handleSubmit}
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
