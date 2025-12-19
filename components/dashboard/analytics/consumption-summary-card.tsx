"use client"

import { Card } from "@/components/ui/card"
import type { ConsumptionSummary } from "@/lib/types"

interface ConsumptionSummaryCardProps {
  data: ConsumptionSummary
}

export function ConsumptionSummaryCard({ data }: ConsumptionSummaryCardProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: data.currency || "USD",
      minimumFractionDigits: 2,
    }).format(amount)
  }

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat("es-AR").format(num)
  }

  return (
    <Card className="p-6">
      <h2 className="text-xl font-semibold mb-6">Resumen del Período</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">Total Conversaciones</div>
          <div className="text-3xl font-bold">{formatNumber(data.totalConversations)}</div>
        </div>

        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">Costo Total</div>
          <div className="text-3xl font-bold">{formatCurrency(data.totalCost)}</div>
          {data.totalCost === 0 && (
            <div className="text-xs text-muted-foreground">
              Los costos pueden no estar disponibles si facturas a través de un BSP
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">Costo Promedio</div>
          <div className="text-3xl font-bold">
            {data.totalConversations > 0 ? formatCurrency(data.totalCost / data.totalConversations) : "$0.00"}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">Período</div>
          <div className="text-sm font-medium">
            {new Date(data.periodStart).toLocaleDateString("es-AR")} -{" "}
            {new Date(data.periodEnd).toLocaleDateString("es-AR")}
          </div>
        </div>
      </div>
    </Card>
  )
}
