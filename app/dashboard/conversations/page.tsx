import { Suspense } from "react"
import { ConversationsClient } from "@/components/dashboard/conversations-client"

export default function ConversationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Conversaciones</h1>
        <p className="text-gray-600">Monitorea todas las conversaciones de tus chatbots</p>
      </div>

      <Suspense fallback={<div>Cargando conversaciones...</div>}>
        <ConversationsClient />
      </Suspense>
    </div>
  )
}
