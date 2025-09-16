import { Suspense } from "react"
import { ConversationsClient } from "@/components/dashboard/conversations-client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function ConversationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Conversaciones</h1>
        <p className="text-muted-foreground">Monitorea y revisa las conversaciones de tus chatbots</p>
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
                <div className="h-4 bg-muted rounded w-3/4"></div>
                <div className="h-4 bg-muted rounded w-1/2"></div>
                <div className="h-4 bg-muted rounded w-2/3"></div>
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
