import { FacturacionSection } from "@/components/dashboard/facturacion-section"

export default function DashboardFacturacionPage() {
  return (
    <div className="container mx-auto py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Facturación</h1>
        <p className="text-muted-foreground mt-2">
          Total de interacciones por cliente en el período seleccionado
        </p>
      </div>
      <FacturacionSection />
    </div>
  )
}

export const dynamic = "force-dynamic"
