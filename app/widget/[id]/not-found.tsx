export default function WidgetNotFound() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="text-center">
        <div className="w-24 h-24 mx-auto mb-6 bg-gray-200 rounded-full flex items-center justify-center">
          <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Widget no encontrado</h1>
        <p className="text-gray-600 mb-6">El widget de chat que estás buscando no existe o no está disponible.</p>
        <div className="space-y-2 text-sm text-gray-500">
          <p>Posibles causas:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>El ID del widget es incorrecto</li>
            <li>El widget ha sido deshabilitado</li>
            <li>La configuración no existe</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
