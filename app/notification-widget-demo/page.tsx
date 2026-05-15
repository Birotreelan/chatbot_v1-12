"use client"

import { useState, useEffect } from "react"

/**
 * Pagina de Demo para el Widget de Notificaciones
 * 
 * Permite probar el widget embebible con diferentes configuraciones
 * y ver como se integra con un iframe del Panel de Atencion al Paciente.
 */
export default function NotificationWidgetDemoPage() {
  const [ssoToken, setSsoToken] = useState("")
  const [position, setPosition] = useState("top-right")
  const [theme, setTheme] = useState("light")
  const [showPanel, setShowPanel] = useState(false)
  const [widgetLoaded, setWidgetLoaded] = useState(false)
  const [baseUrl, setBaseUrl] = useState("")

  useEffect(() => {
    // Obtener URL base del servidor
    setBaseUrl(window.location.origin)
  }, [])

  const loadWidget = () => {
    if (!ssoToken) {
      alert("Por favor ingresa un token SSO valido")
      return
    }

    // Remover widget anterior si existe
    if ((window as any).NotificationWidget) {
      (window as any).NotificationWidget.destroy()
    }

    // Remover script anterior si existe
    const existingScript = document.getElementById("notification-widget-script")
    if (existingScript) {
      existingScript.remove()
    }

    // Configurar el widget
    ;(window as any).NotificationWidgetConfig = {
      ssoToken: ssoToken,
      panelIframeSelector: "#support-panel-iframe",
      panelUrlBase: `${baseUrl}/support`,
      position: position,
      theme: theme,
      baseUrl: baseUrl
    }

    // Cargar el script
    const script = document.createElement("script")
    script.id = "notification-widget-script"
    script.src = `${baseUrl}/notification-widget-loader.js`
    script.onload = () => {
      setWidgetLoaded(true)
      console.log("[Demo] Widget cargado")
    }
    script.onerror = (error) => {
      console.error("[Demo] Error cargando widget:", error)
      alert("Error cargando el widget")
    }
    document.body.appendChild(script)
  }

  const destroyWidget = () => {
    if ((window as any).NotificationWidget) {
      (window as any).NotificationWidget.destroy()
      setWidgetLoaded(false)
    }
  }

  const getWidgetState = () => {
    if ((window as any).NotificationWidget) {
      const state = (window as any).NotificationWidget.getState()
      alert(JSON.stringify(state, null, 2))
    }
  }

  const generateIntegrationCode = () => {
    if (!ssoToken) return "// Ingresa un token SSO primero"
    
    return `<!-- Widget de Notificaciones - Integracion -->
<script>
  window.NotificationWidgetConfig = {
    ssoToken: '${ssoToken}',
    panelIframeSelector: '#support-panel',
    panelUrlBase: '${baseUrl}/support',
    position: '${position}',
    theme: '${theme}'
  };
</script>
<script src="${baseUrl}/notification-widget-loader.js"></script>

<!-- Iframe del Panel (oculto inicialmente) -->
<iframe 
  id="support-panel" 
  style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 99998; border: none;"
  allow="microphone"
></iframe>`
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-2xl font-bold text-gray-900">
          Demo: Widget de Notificaciones
        </h1>
        <p className="text-gray-600 mt-1">
          Prueba el widget embebible para el Panel de Atencion al Paciente
        </p>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* Panel de Configuracion */}
          <div className="space-y-6">
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Configuracion del Widget
              </h2>

              {/* Token SSO */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Token SSO *
                </label>
                <textarea
                  value={ssoToken}
                  onChange={(e) => setSsoToken(e.target.value)}
                  placeholder="Pega aqui tu token SSO generado..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  rows={3}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Genera un token con: node scripts/generate-sso-token.js cliente_id usuario_id nombre apellido
                </p>
              </div>

              {/* Posicion */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Posicion
                </label>
                <select
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="top-right">Arriba Derecha</option>
                  <option value="top-left">Arriba Izquierda</option>
                  <option value="bottom-right">Abajo Derecha</option>
                  <option value="bottom-left">Abajo Izquierda</option>
                </select>
              </div>

              {/* Tema */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tema
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="theme"
                      value="light"
                      checked={theme === "light"}
                      onChange={(e) => setTheme(e.target.value)}
                      className="text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">Claro</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="theme"
                      value="dark"
                      checked={theme === "dark"}
                      onChange={(e) => setTheme(e.target.value)}
                      className="text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">Oscuro</span>
                  </label>
                </div>
              </div>

              {/* Botones */}
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={loadWidget}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  Cargar Widget
                </button>
                <button
                  onClick={destroyWidget}
                  disabled={!widgetLoaded}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Destruir Widget
                </button>
                <button
                  onClick={getWidgetState}
                  disabled={!widgetLoaded}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Ver Estado
                </button>
              </div>

              {widgetLoaded && (
                <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-sm text-green-800">
                    Widget cargado. Mira la esquina {position === "top-right" ? "superior derecha" : position === "top-left" ? "superior izquierda" : position === "bottom-right" ? "inferior derecha" : "inferior izquierda"} de la pantalla.
                  </p>
                </div>
              )}
            </div>

            {/* Panel del Iframe (simulando sistema externo) */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  Panel de Atencion (Iframe)
                </h2>
                <button
                  onClick={() => setShowPanel(!showPanel)}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  {showPanel ? "Ocultar" : "Mostrar"}
                </button>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                Este iframe simula donde se cargaria el Panel de Atencion al Paciente cuando el usuario hace clic en el widget de notificaciones.
              </p>
              {showPanel && ssoToken && (
                <iframe
                  id="support-panel-iframe"
                  src={`${baseUrl}/support?sso_token=${encodeURIComponent(ssoToken)}`}
                  className="w-full h-96 border border-gray-200 rounded-lg"
                  allow="microphone"
                />
              )}
              {showPanel && !ssoToken && (
                <div className="w-full h-96 border border-gray-200 rounded-lg flex items-center justify-center bg-gray-50">
                  <p className="text-gray-500">Ingresa un token SSO para ver el panel</p>
                </div>
              )}
            </div>
          </div>

          {/* Panel de Codigo de Integracion */}
          <div className="space-y-6">
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Codigo de Integracion
              </h2>
              <p className="text-sm text-gray-600 mb-4">
                Copia este codigo HTML en tu sistema externo para integrar el widget de notificaciones:
              </p>
              <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-xs overflow-x-auto">
                <code>{generateIntegrationCode()}</code>
              </pre>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(generateIntegrationCode())
                  alert("Codigo copiado al portapapeles")
                }}
                className="mt-4 px-4 py-2 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-900 transition-colors"
              >
                Copiar Codigo
              </button>
            </div>

            {/* Documentacion */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Documentacion
              </h2>
              
              <div className="space-y-4 text-sm text-gray-700">
                <div>
                  <h3 className="font-medium text-gray-900">Opciones de Configuracion</h3>
                  <ul className="mt-2 space-y-1 list-disc list-inside text-gray-600">
                    <li><code className="bg-gray-100 px-1 rounded">ssoToken</code> - Token SSO del usuario (requerido)</li>
                    <li><code className="bg-gray-100 px-1 rounded">panelIframeSelector</code> - Selector CSS del iframe del panel</li>
                    <li><code className="bg-gray-100 px-1 rounded">panelUrlBase</code> - URL base del panel de soporte</li>
                    <li><code className="bg-gray-100 px-1 rounded">position</code> - Posicion del widget (top-right, top-left, bottom-right, bottom-left)</li>
                    <li><code className="bg-gray-100 px-1 rounded">theme</code> - Tema visual (light, dark)</li>
                  </ul>
                </div>

                <div>
                  <h3 className="font-medium text-gray-900">API JavaScript</h3>
                  <ul className="mt-2 space-y-1 list-disc list-inside text-gray-600">
                    <li><code className="bg-gray-100 px-1 rounded">NotificationWidget.getState()</code> - Obtiene el estado actual</li>
                    <li><code className="bg-gray-100 px-1 rounded">NotificationWidget.refresh()</code> - Reconecta al servidor</li>
                    <li><code className="bg-gray-100 px-1 rounded">NotificationWidget.destroy()</code> - Destruye el widget</li>
                  </ul>
                </div>

                <div>
                  <h3 className="font-medium text-gray-900">Comportamiento</h3>
                  <ul className="mt-2 space-y-1 list-disc list-inside text-gray-600">
                    <li>Muestra badge con conteo de notificaciones</li>
                    <li>Actualiza en tiempo real via Server-Sent Events</li>
                    <li>Reconecta automaticamente si pierde conexion</li>
                    <li>Al hacer clic, actualiza el src del iframe del panel</li>
                    <li>Tooltip muestra detalle de pendientes y activas</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Generar Token de Prueba */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-yellow-800 mb-2">
                Generar Token de Prueba
              </h2>
              <p className="text-sm text-yellow-700 mb-4">
                Para generar un token SSO de prueba, ejecuta este comando en la terminal:
              </p>
              <pre className="bg-yellow-100 text-yellow-900 p-3 rounded text-xs overflow-x-auto">
{`node scripts/generate-sso-token.js \\
  cliente_id \\
  usuario_id \\
  nombre \\
  apellido \\
  60`}
              </pre>
              <p className="text-xs text-yellow-600 mt-2">
                Nota: El cliente_id debe corresponder a un cliente configurado en la base de datos.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
