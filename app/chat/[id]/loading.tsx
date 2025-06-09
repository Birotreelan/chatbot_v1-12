export default function Loading() {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-50">
      <div className="w-16 h-16 border-4 border-gray-300 border-t-blue-500 rounded-full animate-spin mb-4"></div>
      <h2 className="text-xl font-medium text-gray-700">Cargando chat...</h2>
      <p className="text-gray-500 mt-2">Estamos preparando todo para ti</p>
    </div>
  )
}
