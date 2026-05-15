import { ConversationView } from "@/components/support/conversation-view"

export default function SessionPage({
  params,
}: {
  params: { sessionId: string }
}) {
  return (
    <div className="container mx-auto py-3 px-4">
      <ConversationView sessionId={params.sessionId} />
    </div>
  )
}

export const dynamic = "force-dynamic"
