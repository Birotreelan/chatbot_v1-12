import { FacturacionTable } from "@/components/dashboard/facturacion-table"

export default function FacturacionPage() {
  return (
    <div className="container mx-auto py-6 px-4 space-y-10">
      <div>
        <h1 className="text-2xl font-bold">Facturación</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Total de interacciones por cliente en el período seleccionado
        </p>
      </div>
      <FacturacionTable />
      <FacturacionTable
        title="Facturación de clientes Wpp sin IA"
        apiPath="/api/facturacion/interacciones-sin-ia"
        cantidadLabel="Mensajes pagados"
      />
    </div>
  )
}

export const dynamic = "force-dynamic"
