"use client"

import { useState, useEffect } from "react"
import { MessageSquare, X } from "lucide-react"
import WidgetChat from "./widget-chat"
import type { WhatsAppConfig } from "@/lib/types"

interface ChatDemoProps {
  config: WhatsAppConfig
}

export function ChatDemo({ config }: ChatDemoProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Asegurarse de que el componente solo se renderice en el cliente
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  const toggleChat = () => {
    setIsOpen(!isOpen)
  }

  // Determinar la posición del widget basado en la configuración
  const positionClasses = {
    "bottom-right": "bottom-4 right-4",
    "bottom-left": "bottom-4 left-4",
    "top-right": "top-4 right-4",
    "top-left": "top-4 left-4",
  }

  const position = positionClasses[config.widgetPosition || "bottom-right"]

  // Determinar el tema del widget
  const isDarkTheme =
    config.widgetTheme === "dark" ||
    (config.widgetTheme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches)

  return (
    <div className="fixed z-50">
      {/* Widget flotante */}
      {isOpen && (
        <div
          className={`fixed ${position} transition-all duration-300 ease-in-out`}
          style={{
            width: `${config.widgetMaxWidth || 400}px`,
            maxHeight: `${config.widgetMaxHeight || 600}px`,
            borderRadius: `${config.widgetBorderRadius || 12}px`,
            boxShadow: config.widgetShadow
              ? "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)"
              : "none",
            animation: config.widgetAnimation ? "slideIn 0.3s ease-out" : "none",
            backgroundColor: isDarkTheme ? "#1f2937" : "#ffffff",
          }}
        >
          <div className="relative h-[600px] max-h-[80vh] overflow-hidden flex flex-col rounded-lg">
            <button
              onClick={toggleChat}
              className="absolute top-2 right-2 z-10 p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              aria-label="Cerrar chat"
            >
              <X className="w-5 h-5" />
            </button>

            <WidgetChat
              clienteId={config.cliente_id || ""}
              config={{
                widgetTitle: config.widgetHeaderText,
                widgetSubtitle: config.widgetSubtitle,
                widgetWelcomeMessage: config.widgetWelcomeMessage,
                widgetPlaceholder: config.widgetPlaceholder,
                widgetPrimaryColor: config.widgetPrimaryColor,
                widgetSecondaryColor: config.widgetSecondaryColor,
              }}
            />
          </div>
        </div>
      )}

      {/* Botón flotante para abrir el chat */}
      <button
        onClick={toggleChat}
        className={`fixed ${position} flex items-center gap-3 p-4 rounded-full text-white transition-all duration-300 hover:scale-105`}
        style={{
          backgroundColor: config.widgetPrimaryColor || "#0ea5e9",
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
        }}
        aria-label="Abrir chat"
      >
        {isOpen ? (
          <X className="w-6 h-6" />
        ) : (
          <>
            <MessageSquare className="w-6 h-6" />
            {/* Mostrar el texto del botón flotante si está habilitado */}
            {config.widgetShowFloatingText && config.widgetFloatingButtonText && (
              <span className="text-sm font-medium max-w-[200px] hidden md:inline-block">
                {config.widgetFloatingButtonText}
              </span>
            )}
          </>
        )}
      </button>
    </div>
  )
}
