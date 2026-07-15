import { FacturacionTable } from "@/components/dashboard/facturacion-table"

export default function DashboardFacturacionPage() {
  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Facturación</h1>
        <p className="text-muted-foreground mt-2">
          Total de interacciones por cliente en el período seleccionado
        </p>
      </div>
      <FacturacionTable />
    </div>
  )
}

export const dynamic = "force-dynamic"
