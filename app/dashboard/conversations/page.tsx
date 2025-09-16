import { Suspense } from "react"
import { ConversationsClient } from "@/components/dashboard/conversations-client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function ConversationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Conversaciones</h1>
        <p className="text-muted-foreground">Visualiza y gestiona las conversaciones de WhatsApp</p>
      </div>

      <Suspense
        fallback={
          <Card>
            <CardHeader>
              <CardTitle>Cargando conversaciones...</CardTitle>
              <CardDescription>Obteniendo las conversaciones más recientes</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="animate-pulse space-y-4">
                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                <div className="h-4 bg-gray-200 rounded w-5/6"></div>
              </div>
            </CardContent>
          </Card>
        }
      >
        <ConversationsClient />
      </Suspense>
    </div>
  )
}
