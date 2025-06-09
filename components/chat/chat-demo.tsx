"use client"

import { useState } from "react"
import { MessageCircle, X, Minus } from "lucide-react"
import WidgetChat from "./widget-chat"

interface ChatDemoProps {
  config: {
    id: string
    cliente_id: string
    displayName: string
    widgetEnabled: boolean
    widgetTitle?: string
    widgetSubtitle?: string
    widgetWelcomeMessage?: string
    widgetPlaceholder?: string
    widgetPrimaryColor?: string
    widgetSecondaryColor?: string
    widgetPosition?: string
    widgetSize?: string
    widgetButtonText?: string
    widgetFloatingText?: string
    widgetBorderRadius?: string
  }
  isEmbedded?: boolean
}

export function ChatDemo({ config, isEmbedded = false }: ChatDemoProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)

  // Configuración de posición
  const position = config.widgetPosition || "bottom-right"
  const isBottomRight = position === "bottom-right"
  const isBottomLeft = position === "bottom-left"

  // Configuración de tamaño
  const size = config.widgetSize || "medium"
  const getWidgetSize = () => {
    switch (size) {
      case "small":
        return { width: "320px", height: "400px" }
      case "large":
        return { width: "420px", height: "600px" }
      default: // medium
        return { width: "380px", height: "500px" }
    }
  }

  const widgetSize = getWidgetSize()
  const primaryColor = config.widgetPrimaryColor || "#0ea5e9"
  const borderRadius = config.widgetBorderRadius || "12px"

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header de la página de demostración */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">Treelan Assistants</h1>
            <p className="text-xl text-gray-600">Widget Demo</p>
            <div className="mt-4 p-4 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>Configuración:</strong> {config.displayName} |<strong> Cliente ID:</strong> {config.cliente_id}{" "}
                |<strong> Estado:</strong> {config.widgetEnabled ? "Activo" : "Inactivo"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Contenido de la página simulada */}
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">Bienvenido a nuestro sitio web</h2>
          <p className="text-gray-600 mb-6">
            Esta es una página de demostración que simula cómo se vería el widget de chat en un sitio web real. El
            widget aparece en la esquina inferior derecha y respeta toda la configuración establecida en el panel de
            control.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-gray-50 p-6 rounded-lg">
              <h3 className="text-lg font-medium text-gray-900 mb-3">Características del Widget</h3>
              <ul className="space-y-2 text-sm text-gray-600">
                <li>• Botón flotante personalizable</li>
                <li>• Colores y estilos configurables</li>
                <li>• Mensajes de bienvenida personalizados</li>
                <li>• Posicionamiento flexible</li>
                <li>• Integración con OpenAI</li>
              </ul>
            </div>

            <div className="bg-gray-50 p-6 rounded-lg">
              <h3 className="text-lg font-medium text-gray-900 mb-3">Configuración Actual</h3>
              <ul className="space-y-2 text-sm text-gray-600">
                <li>
                  • <strong>Título:</strong> {config.widgetTitle || "Asistente Virtual"}
                </li>
                <li>
                  • <strong>Posición:</strong> {position}
                </li>
                <li>
                  • <strong>Tamaño:</strong> {size}
                </li>
                <li>
                  • <strong>Color:</strong> {primaryColor}
                </li>
                <li>
                  • <strong>Texto del botón:</strong> {config.widgetButtonText || "¿Necesitas ayuda?"}
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Contenido adicional para simular una página real */}
        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Servicio 1</h3>
            <p className="text-gray-600">Descripción del primer servicio que ofrece la empresa.</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Servicio 2</h3>
            <p className="text-gray-600">Descripción del segundo servicio que ofrece la empresa.</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Servicio 3</h3>
            <p className="text-gray-600">Descripción del tercer servicio que ofrece la empresa.</p>
          </div>
        </div>
      </div>

      {/* Widget flotante */}
      {config.widgetEnabled && (
        <div
          className="fixed z-50"
          style={{
            bottom: "20px",
            right: isBottomRight ? "20px" : "auto",
            left: isBottomLeft ? "20px" : "auto",
          }}
        >
          {/* Texto flotante */}
          {!isOpen && config.widgetFloatingText && (
            <div
              className="mb-3 px-4 py-2 bg-white rounded-lg shadow-lg border text-sm text-gray-700 max-w-xs animate-bounce"
              style={{
                marginRight: isBottomRight ? "70px" : "0",
                marginLeft: isBottomLeft ? "70px" : "0",
              }}
            >
              {config.widgetFloatingText}
            </div>
          )}

          {/* Widget expandido */}
          {isOpen && (
            <div
              className="bg-white rounded-lg shadow-2xl border overflow-hidden mb-4"
              style={{
                width: widgetSize.width,
                height: isMinimized ? "60px" : widgetSize.height,
                borderRadius: borderRadius,
              }}
            >
              {isMinimized ? (
                // Header minimizado
                <div
                  className="p-4 text-white flex items-center justify-between cursor-pointer"
                  style={{ backgroundColor: primaryColor }}
                  onClick={() => setIsMinimized(false)}
                >
                  <div className="flex items-center space-x-2">
                    <MessageCircle className="w-5 h-5" />
                    <span className="font-medium">{config.widgetTitle || "Asistente Virtual"}</span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setIsOpen(false)
                      setIsMinimized(false)
                    }}
                    className="text-white hover:text-gray-200 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                // Widget completo
                <div className="h-full flex flex-col">
                  {/* Header del widget con controles */}
                  <div
                    className="p-4 text-white flex items-center justify-between"
                    style={{ backgroundColor: primaryColor }}
                  >
                    <div>
                      <h3 className="font-semibold text-lg">{config.widgetTitle || "Asistente Virtual"}</h3>
                      <p className="text-sm opacity-90">{config.widgetSubtitle || "Estamos aquí para ayudarte"}</p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => setIsMinimized(true)}
                        className="text-white hover:text-gray-200 transition-colors"
                      >
                        <Minus className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => {
                          setIsOpen(false)
                          setIsMinimized(false)
                        }}
                        className="text-white hover:text-gray-200 transition-colors"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  {/* Contenido del chat */}
                  <div className="flex-1 overflow-hidden">
                    <WidgetChat
                      clienteId={config.cliente_id}
                      config={{
                        widgetTitle: config.widgetTitle,
                        widgetSubtitle: config.widgetSubtitle,
                        widgetWelcomeMessage: config.widgetWelcomeMessage,
                        widgetPlaceholder: config.widgetPlaceholder,
                        widgetPrimaryColor: config.widgetPrimaryColor,
                        widgetSecondaryColor: config.widgetSecondaryColor,
                      }}
                      hideHeader={true}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Botón flotante */}
          {!isOpen && (
            <button
              onClick={() => setIsOpen(true)}
              className="w-14 h-14 rounded-full text-white shadow-lg hover:shadow-xl transition-all duration-300 flex items-center justify-center group"
              style={{
                backgroundColor: primaryColor,
                borderRadius: borderRadius === "0px" ? "50%" : borderRadius,
              }}
            >
              <MessageCircle className="w-6 h-6 group-hover:scale-110 transition-transform" />
            </button>
          )}
        </div>
      )}

      {/* Mensaje si el widget está deshabilitado */}
      {!config.widgetEnabled && (
        <div className="fixed bottom-4 right-4 bg-red-100 border border-red-300 text-red-700 px-4 py-2 rounded-lg shadow-lg">
          <p className="text-sm">Widget deshabilitado en la configuración</p>
        </div>
      )}
    </div>
  )
}
