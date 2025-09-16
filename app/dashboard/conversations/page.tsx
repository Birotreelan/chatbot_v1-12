import { Suspense } from "react"
import { ConversationsClient } from "@/components/dashboard/conversations-client"

export default function ConversationsPage() {
  return (
    <div className="container mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Conversaciones</h1>
        <p className="text-muted-foreground">Monitorea todas las conversaciones de WhatsApp en tiempo real</p>
      </div>

      <Suspense fallback={<div>Cargando conversaciones...</div>}>
        <ConversationsClient />
      </Suspense>
    </div>
  )
}
