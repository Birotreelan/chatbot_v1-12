import { ConversationsClient } from "@/components/dashboard/conversations-client"

export default function ConversationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Conversaciones</h1>
        <p className="text-muted-foreground">Monitorea todas las conversaciones de tus chatbots</p>
      </div>
      <ConversationsClient />
    </div>
  )
}

export const dynamic = "force-dynamic"
