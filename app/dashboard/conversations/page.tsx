import { Suspense } from "react"
import { ConversationsView } from "@/components/dashboard/conversations-view"

export default function ConversationsPage() {
  return (
    <div className="h-[calc(100vh-4rem)]">
      <Suspense fallback={<div className="flex items-center justify-center h-full">Cargando conversaciones...</div>}>
        <ConversationsView />
      </Suspense>
    </div>
  )
}

export const dynamic = "force-dynamic"
