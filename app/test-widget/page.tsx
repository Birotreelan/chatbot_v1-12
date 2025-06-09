"use client"

import { useState } from "react"
import WidgetChat from "@/components/chat/widget-chat"
import { Button } from "@/components/ui/button"

export default function TestWidgetPage() {
  const [showWidget, setShowWidget] = useState(true)

  const config = {
    widgetTitle: "Asistente Virtual de Prueba",
    widgetSubtitle: "Estamos aquí para ayudarte",
    widgetWelcomeMessage: "¡Hola! Soy el asistente virtual de prueba. Puedes probar los botones interactivos.",
    widgetPrimaryColor: "#0052cc",
    widgetSecondaryColor: "#ffffff",
    widgetPlaceholder: "Escribe tu mensaje...",
  }

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg overflow-hidden">
        <div className="p-4 bg-blue-600 text-white">
          <h1 className="text-xl font-bold">Prueba del Widget de Chat</h1>
          <p className="text-sm opacity-80">Verifica que los botones interactivos funcionen correctamente</p>
        </div>

        <div className="p-4">
          <Button
            onClick={() => setShowWidget(!showWidget)}
            className="mb-4"
            variant={showWidget ? "destructive" : "default"}
          >
            {showWidget ? "Ocultar Widget" : "Mostrar Widget"}
          </Button>

          {showWidget && (
            <div className="border rounded-lg overflow-hidden" style={{ height: "600px" }}>
              <WidgetChat clienteId="a9454478-89c1-11e3-a751-081012379997" config={config} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
