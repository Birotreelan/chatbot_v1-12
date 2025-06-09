"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { MessageCircle, X, Minus } from "lucide-react"

interface WidgetDemoProps {
  config: any
  primaryColor: string
}

// Cambiando a exportación nombrada en lugar de default
export const WidgetDemo: React.FC<WidgetDemoProps> = ({ config, primaryColor }) => {
  const [isOpen, setIsOpen] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [messages, setMessages] = useState<
    Array<{ id: string; text: string; sender: "user" | "bot"; timestamp: Date }>
  >([])
  const [inputValue, setInputValue] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  // Configuración del widget con valores por defecto
  const widgetConfig = {
    title: config.widgetTitle || "Asistente Virtual",
    subtitle: config.widgetSubtitle || "Estamos aquí para ayudarte",
    welcomeMessage: config.widgetWelcomeMessage || "¡Hola! ¿En qué puedo ayudarte hoy?",
    placeholder: config.widgetPlaceholder || "Escribe tu mensaje...",
    primaryColor: primaryColor || "#3b82f6",
    secondaryColor: config.widgetSecondaryColor || "#f1f5f9",
    position: config.widgetPosition || "bottom-right",
    buttonText: config.widgetButtonText || "¿Necesitas ayuda?",
    size: config.widgetSize || "medium",
  }

  // Agregar mensaje de bienvenida al cargar
  useEffect(() => {
    if (widgetConfig.welcomeMessage) {
      setMessages([
        {
          id: "1",
          text: widgetConfig.welcomeMessage,
          sender: "bot",
          timestamp: new Date(),
        },
      ])
    }
  }, [widgetConfig.welcomeMessage])

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return

    const userMessage = {
      id: Date.now().toString(),
      text: inputValue,
      sender: "user" as const,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInputValue("")
    setIsLoading(true)

    // Simular respuesta del bot
    setTimeout(() => {
      const botMessage = {
        id: (Date.now() + 1).toString(),
        text: "Gracias por tu mensaje. Este es un widget de demostración. En la versión real, aquí aparecería la respuesta del asistente de IA.",
        sender: "bot" as const,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, botMessage])
      setIsLoading(false)
    }, 1500)
  }

  const getPositionClasses = () => {
    switch (widgetConfig.position) {
      case "bottom-left":
        return "bottom-6 left-6"
      case "bottom-right":
      default:
        return "bottom-6 right-6"
    }
  }

  const getSizeClasses = () => {
    switch (widgetConfig.size) {
      case "small":
        return "w-80 h-96"
      case "large":
        return "w-96 h-[500px]"
      case "medium":
      default:
        return "w-80 h-[450px]"
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 relative">
      {/* Página de demostración */}
      <div className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Treelan Assistants</h1>
          <p className="text-xl text-gray-600">Widget Demo</p>
        </div>

        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">Demostración del Widget de Chat</h2>
            <p className="text-gray-600 mb-6">
              Esta es una demostración de cómo se verá tu widget de chat cuando esté integrado en una página web. El
              widget aparece como un botón flotante en la esquina de la pantalla y se expande cuando los usuarios hacen
              clic en él.
            </p>

            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-lg font-medium text-gray-800 mb-3">Configuración Actual:</h3>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li>
                    <strong>Título:</strong> {widgetConfig.title}
                  </li>
                  <li>
                    <strong>Subtítulo:</strong> {widgetConfig.subtitle}
                  </li>
                  <li>
                    <strong>Posición:</strong> {widgetConfig.position}
                  </li>
                  <li>
                    <strong>Tamaño:</strong> {widgetConfig.size}
                  </li>
                  <li>
                    <strong>Color primario:</strong>{" "}
                    <span
                      className="inline-block w-4 h-4 rounded ml-1"
                      style={{ backgroundColor: widgetConfig.primaryColor }}
                    ></span>
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="text-lg font-medium text-gray-800 mb-3">Instrucciones:</h3>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li>• Haz clic en el botón flotante para abrir el chat</li>
                  <li>• Usa los controles del header para minimizar o cerrar</li>
                  <li>• Escribe un mensaje para probar la funcionalidad</li>
                  <li>• El widget mantiene su posición y configuración</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Widget flotante */}
      <div className={`fixed ${getPositionClasses()} z-50`}>
        {/* Texto flotante del botón */}
        {!isOpen && widgetConfig.buttonText && (
          <div className="absolute bottom-16 right-0 bg-white px-3 py-2 rounded-lg shadow-lg text-sm text-gray-700 whitespace-nowrap animate-bounce">
            {widgetConfig.buttonText}
            <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-white"></div>
          </div>
        )}

        {/* Botón flotante */}
        {!isOpen && (
          <button
            onClick={() => setIsOpen(true)}
            className="w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-white hover:scale-110 transition-transform duration-200"
            style={{ backgroundColor: widgetConfig.primaryColor }}
          >
            <MessageCircle size={24} />
          </button>
        )}

        {/* Ventana del chat */}
        {isOpen && (
          <div
            className={`${getSizeClasses()} bg-white rounded-lg shadow-2xl flex flex-col overflow-hidden ${isMinimized ? "h-12" : ""}`}
          >
            {/* Header */}
            <div
              className="p-4 text-white flex items-center justify-between"
              style={{ backgroundColor: widgetConfig.primaryColor }}
            >
              <div className={isMinimized ? "hidden" : ""}>
                <h3 className="font-semibold text-sm">{widgetConfig.title}</h3>
                <p className="text-xs opacity-90">{widgetConfig.subtitle}</p>
              </div>
              {isMinimized && <h3 className="font-semibold text-sm">{widgetConfig.title}</h3>}
              <div className="flex items-center space-x-2">
                <button onClick={() => setIsMinimized(!isMinimized)} className="hover:bg-white/20 p-1 rounded">
                  <Minus size={16} />
                </button>
                <button onClick={() => setIsOpen(false)} className="hover:bg-white/20 p-1 rounded">
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Contenido del chat */}
            {!isMinimized && (
              <>
                {/* Mensajes */}
                <div className="flex-1 p-4 overflow-y-auto space-y-4">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.sender === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-xs px-3 py-2 rounded-lg text-sm ${
                          message.sender === "user" ? "text-white" : "bg-gray-100 text-gray-800"
                        }`}
                        style={message.sender === "user" ? { backgroundColor: widgetConfig.primaryColor } : {}}
                      >
                        {message.text}
                      </div>
                    </div>
                  ))}

                  {isLoading && (
                    <div className="flex justify-start">
                      <div className="bg-gray-100 px-3 py-2 rounded-lg">
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
                </div>

                {/* Input */}
                <div className="p-4 border-t">
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
                      placeholder={widgetConfig.placeholder}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-opacity-50 text-sm"
                      style={{ focusRingColor: widgetConfig.primaryColor }}
                      disabled={isLoading}
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={isLoading || !inputValue.trim()}
                      className="px-4 py-2 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
                      style={{ backgroundColor: widgetConfig.primaryColor }}
                    >
                      Enviar
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Asegurando que también haya una exportación por defecto para compatibilidad
export default WidgetDemo
