import { ConversationsView } from "@/components/dashboard/conversations-view"

export default function ConversationsPage() {
  return (
    <div className="h-[calc(100vh-4rem)]">
      <ConversationsView />
    </div>
  )
}

export const dynamic = "force-dynamic"
