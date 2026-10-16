import { ServicioSection } from "@/components/dashboard/servicio-section"

/**
 * /dashboard/servicio — por ahora, lo mismo que Facturación (16/10/2026).
 *
 * Vive dentro de /dashboard a propósito: el layout de esa área exige
 * `super_admin`, así que un Agente de Facturación —que entra a /facturacion y
 * no acá— no la ve. Ver la cabecera de components/dashboard/servicio-section.tsx.
 */
export default function DashboardServicioPage() {
  return (
    <div className="container mx-auto py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Servicio</h1>
        <p className="text-muted-foreground mt-2">
          Total de interacciones por cliente en el período seleccionado
        </p>
      </div>
      <ServicioSection />
    </div>
  )
}

export const dynamic = "force-dynamic"
