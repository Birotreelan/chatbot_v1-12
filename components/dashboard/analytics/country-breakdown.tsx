"use client"

import { Card } from "@/components/ui/card"
import type { ConsumptionSummary } from "@/lib/types"

interface CountryBreakdownProps {
  data: ConsumptionSummary
}

export function CountryBreakdown({ data }: CountryBreakdownProps) {
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

  // Convertir el objeto de países a un array y ordenar por cantidad de conversaciones
  const countriesArray = Object.entries(data.byCountry)
    .map(([country, stats]) => ({
      country,
      ...stats,
    }))
    .sort((a, b) => b.count - a.count)

  // Si no hay datos de países, no mostrar la tarjeta
  if (countriesArray.length === 0) {
    return null
  }

  return (
    <Card className="p-6">
      <h2 className="text-xl font-semibold mb-6">Desglose por País</h2>
      <div className="space-y-4">
        {countriesArray.map(({ country, count, cost }) => {
          const percentage = data.totalConversations > 0 ? (count / data.totalConversations) * 100 : 0

          return (
            <div key={country} className="flex items-center justify-between py-3 border-b last:border-b-0">
              <div className="flex-1">
                <div className="font-medium">{country}</div>
                <div className="text-sm text-muted-foreground">{percentage.toFixed(1)}% del total</div>
              </div>
              <div className="text-right">
                <div className="font-semibold">{formatNumber(count)} conversaciones</div>
                {cost > 0 && <div className="text-sm text-muted-foreground">{formatCurrency(cost)}</div>}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
