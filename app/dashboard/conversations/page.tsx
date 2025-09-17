"use client"

import { useState } from "react"
import ConversationsList from "@/components/dashboard/conversations-list"
import ConversationDetail from "@/components/dashboard/conversation-detail"
import type { Conversation } from "@/lib/types"

export default function ConversationsPage() {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null)

  const handleSelectConversation = (conversation: Conversation) => {
    setSelectedConversation(conversation)
  }

  const handleBack = () => {
    setSelectedConversation(null)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Conversaciones</h1>
        <p className="text-gray-600 mt-2">Monitorea y revisa todas las conversaciones de WhatsApp</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className={selectedConversation ? "hidden lg:block" : ""}>
          <ConversationsList
            onSelectConversation={handleSelectConversation}
            selectedConversationId={selectedConversation?.id}
          />
        </div>

        <div className={!selectedConversation ? "hidden lg:block" : ""}>
          {selectedConversation ? (
            <ConversationDetail conversation={selectedConversation} onBack={handleBack} />
          ) : (
            <div className="hidden lg:flex items-center justify-center h-96 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
              <div className="text-center">
                <div className="text-gray-400 mb-4">
                  <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-3.582 8-8 8a8.955 8.955 0 01-4.126-.98L3 21l1.98-5.874A8.955 8.955 0 013 12c0-4.418 3.582-8 8-8s8 3.582 8 8z"
                    />
                  </svg>
                </div>
                <p className="text-gray-500">Selecciona una conversación para ver los detalles</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
