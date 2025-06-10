import Link from "next/link"
import { Button } from "@/components/ui/button"

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 border rounded-lg">
      <h2 className="text-xl font-semibold mb-2">No hay configuraciones de WhatsApp</h2>
      <p className="text-muted-foreground mb-6">
        Comienza añadiendo tu primer número de WhatsApp para conectarlo con un asistente de IA.
      </p>
      <Link href="/dashboard/config/new">
        <Button>Añadir Número de WhatsApp</Button>
      </Link>
    </div>
  )
}
