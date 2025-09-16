import { Suspense } from "react"
import { ConversationsClient } from "@/components/dashboard/conversations-client"

export default function ConversationsPage() {
  return (
    <div className="container mx-auto py-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">Conversaciones</h1>
          <p className="text-muted-foreground">Monitorea todas las conversaciones de tus chatbots</p>
        </div>
      </div>

      <Suspense fallback={<div className="p-4 border rounded-md">Cargando conversaciones...</div>}>
        <ConversationsClient />
      </Suspense>
    </div>
  )
}

export const dynamic = "force-dynamic"
