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
    <div className="container mx-auto py-6">
      {selectedConversation ? (
        <ConversationDetail conversation={selectedConversation} onBack={handleBack} />
      ) : (
        <ConversationsList onSelectConversation={handleSelectConversation} />
      )}
    </div>
  )
}
