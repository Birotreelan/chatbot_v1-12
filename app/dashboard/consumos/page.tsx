import { ConsumptionDashboard } from "@/components/dashboard/analytics/consumption-dashboard"

export default function ConsumosPage() {
  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Consumos y Facturación</h1>
        <p className="text-muted-foreground mt-2">
          Visualiza el consumo de mensajes y conversaciones de tus cuentas de WhatsApp Business
        </p>
      </div>
      <ConsumptionDashboard />
    </div>
  )
}

export const dynamic = "force-dynamic"
