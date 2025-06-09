export default function Loading() {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-white">
      <div className="w-16 h-16 border-4 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
      <p className="mt-4 text-lg text-gray-700">Cargando chat...</p>
      <p className="mt-2 text-sm text-gray-500">Por favor espere mientras preparamos su asistente.</p>
    </div>
  )
}
