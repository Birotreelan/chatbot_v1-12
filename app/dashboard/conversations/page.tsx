"use client"

import { useState } from "react"
import { ConversationsList } from "@/components/dashboard/conversations-list"
import { ConversationDetail } from "@/components/dashboard/conversation-detail"

export default function ConversationsPage() {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)

  const handleSelectConversation = (conversationId: string) => {
    setSelectedConversationId(conversationId)
  }

  const handleBack = () => {
    setSelectedConversationId(null)
  }

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Conversaciones</h1>
        <p className="text-gray-600 mt-2">Monitorea y revisa todas las conversaciones de WhatsApp</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[calc(100vh-200px)]">
        <div className={selectedConversationId ? "hidden lg:block" : ""}>
          <ConversationsList
            onSelectConversation={handleSelectConversation}
            selectedConversationId={selectedConversationId || undefined}
          />
        </div>

        <div className={selectedConversationId ? "" : "hidden lg:block"}>
          {selectedConversationId ? (
            <ConversationDetail conversationId={selectedConversationId} onBack={handleBack} />
          ) : (
            <div className="flex items-center justify-center h-full border-2 border-dashed border-gray-300 rounded-lg">
              <div className="text-center text-gray-500">
                <p className="text-lg font-medium">Selecciona una conversación</p>
                <p className="text-sm">Elige una conversación de la lista para ver los detalles</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
