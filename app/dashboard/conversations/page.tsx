import { Suspense } from "react"
import { ConversationsClient } from "@/components/dashboard/conversations-client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function ConversationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Conversaciones</h1>
        <p className="text-muted-foreground">Monitorea y revisa las conversaciones de WhatsApp por cliente</p>
      </div>

      <Suspense
        fallback={
          <Card>
            <CardHeader>
              <CardTitle>Cargando...</CardTitle>
              <CardDescription>Obteniendo datos de conversaciones</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
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
