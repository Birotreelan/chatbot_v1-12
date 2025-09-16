import { ConversationsClient } from "@/components/dashboard/conversations-client"

export default function ConversationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Conversaciones</h1>
        <p className="text-gray-600">Monitorea las conversaciones de WhatsApp de tus clientes</p>
      </div>

      <ConversationsClient />
    </div>
  )
}
