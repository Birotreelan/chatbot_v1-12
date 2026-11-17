import Link from "next/link"
import { Button } from "@/components/ui/button"

export function DashboardHeader({ title }: { title?: string }) {
  return (
    /**
     * En columna hasta `sm` (17/11/2026).
     *
     * Era `flex justify-between` sin `flex-wrap`: en un teléfono el botón se
     * queda con su ancho y el título se comprime a una palabra por renglón
     * —"Panel de / Control / de / Treelan / Iris AI"— con el botón encima.
     * El título es lo primero que se lee y terminaba siendo lo menos legible
     * de la pantalla.
     */
    <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h1 className="text-2xl font-bold sm:text-3xl">
        {title || "Panel de Control de Treelan Iris AI"}
      </h1>
      <Link href="/dashboard/config/new" className="shrink-0">
        {/* Ancho completo en el teléfono: un botón de borde a borde se toca
            con el pulgar sin apuntar. */}
        <Button className="w-full sm:w-auto">Nuevo Número de WhatsApp</Button>
      </Link>
    </div>
  )
}
