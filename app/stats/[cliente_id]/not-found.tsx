import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Cliente no encontrado</CardTitle>
          <CardDescription>
            No se encontró ninguna configuración asociada al ID de cliente proporcionado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Verifica que el ID de cliente sea correcto o contacta al administrador del sistema.
          </p>
          <Button asChild variant="outline" className="w-full bg-transparent">
            <Link href="/">Volver al inicio</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
