import { getConfigByClienteId } from "@/lib/db"

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente_id?: string }>
}) {
  const params = await searchParams

  // Usar un cliente_id por defecto para la demo o el proporcionado
  const clienteId = params.cliente_id || "demo-client"

  // Verificar si existe la configuración (opcional para demo)
  let config = null
  try {
    config = await getConfigByClienteId(clienteId)
  } catch (error) {
    // Si no existe, usaremos valores por defecto para la demo
    console.log("Usando configuración por defecto para la demo")
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Demostración del Widget de Chat</h1>
              <p className="text-gray-600 mt-1">Prueba nuestro widget de chat inteligente en acción</p>
            </div>
            <div className="text-sm text-gray-500">
              Cliente ID: <code className="bg-gray-100 px-2 py-1 rounded">{clienteId}</code>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Información del Widget */}
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-xl font-semibold mb-4">¿Cómo funciona?</h2>
              <div className="space-y-4 text-gray-600">
                <p>
                  Este widget de chat utiliza inteligencia artificial para responder automáticamente a las consultas de
                  tus usuarios.
                </p>
                <ul className="list-disc list-inside space-y-2">
                  <li>Respuestas automáticas 24/7</li>
                  <li>Integración fácil en cualquier sitio web</li>
                  <li>Personalización completa de colores y textos</li>
                  <li>Gestión de conversaciones desde el panel de control</li>
                </ul>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-xl font-semibold mb-4">Configuración Actual</h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Estado del Widget:</span>
                  <span className={`font-medium ${config?.widgetEnabled ? "text-green-600" : "text-orange-600"}`}>
                    {config?.widgetEnabled ? "Habilitado" : "Demo (sin configuración)"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Título:</span>
                  <span className="font-medium">{config?.widgetTitle || "Chat en vivo"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Color Primario:</span>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-4 h-4 rounded border"
                      style={{ backgroundColor: config?.widgetPrimaryColor || "#0ea5e9" }}
                    ></div>
                    <span className="font-mono text-xs">{config?.widgetPrimaryColor || "#0ea5e9"}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-xl font-semibold mb-4">Integración</h2>
              <p className="text-gray-600 mb-4">
                Para integrar este widget en tu sitio web, simplemente añade este código antes del cierre del tag
                &lt;/body&gt;:
              </p>
              <div className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto">
                <code className="text-sm">
                  {`<script 
  src="${typeof window !== "undefined" ? window.location.origin : "https://tu-dominio.com"}/widget-loader.js" 
  data-client-id="${clienteId}"
></script>`}
                </code>
              </div>
            </div>
          </div>

          {/* Vista Previa */}
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-xl font-semibold mb-4">Vista Previa</h2>
              <p className="text-gray-600 mb-4">
                El widget aparecerá en la esquina inferior derecha de tu sitio web. Haz clic en el botón azul para
                probarlo.
              </p>

              {/* Simulación de una página web */}
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 min-h-[400px] relative bg-gradient-to-br from-blue-50 to-indigo-100">
                <div className="text-center text-gray-500">
                  <div className="mb-4">
                    <div className="w-16 h-16 bg-gray-200 rounded-lg mx-auto mb-4"></div>
                    <h3 className="text-lg font-medium text-gray-700">Tu Sitio Web</h3>
                    <p className="text-sm text-gray-500">El widget se mostrará aquí</p>
                  </div>

                  <div className="mt-8 space-y-2 text-xs text-gray-400">
                    <p>• El widget no interfiere con tu contenido</p>
                    <p>• Se adapta automáticamente a dispositivos móviles</p>
                    <p>• Carga de forma asíncrona sin afectar la velocidad</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-blue-800">Nota sobre la Demo</h3>
                  <div className="mt-2 text-sm text-blue-700">
                    <p>
                      Esta es una demostración del widget. Para una experiencia completa, configura tu propio cliente
                      desde el panel de administración.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Widget Script */}
      <script src="/widget-loader.js" data-client-id={clienteId} async />
    </div>
  )
}
