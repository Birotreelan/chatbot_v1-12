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
      {selectedConversationId ? (
        <ConversationDetail conversationId={selectedConversationId} onBack={handleBack} />
      ) : (
        <ConversationsList onSelectConversation={handleSelectConversation} />
      )}
    </div>
  )
}
