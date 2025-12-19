"use client"

import { Card } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import type { ConsumptionSummary } from "@/lib/types"

interface ConversationCategoryBreakdownProps {
  data: ConsumptionSummary
}

export function ConversationCategoryBreakdown({ data }: ConversationCategoryBreakdownProps) {
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

  const categories = [
    {
      name: "Authentication",
      emoji: "🔐",
      data: data.byCategory.authentication,
      color: "bg-blue-500",
      description: "Códigos de verificación y autenticación",
    },
    {
      name: "Marketing",
      emoji: "📢",
      data: data.byCategory.marketing,
      color: "bg-purple-500",
      description: "Promociones y campañas de marketing",
    },
    {
      name: "Service",
      emoji: "💬",
      data: data.byCategory.service,
      color: "bg-green-500",
      description: "Conversaciones iniciadas por usuarios (Gratis)",
    },
    {
      name: "Utility",
      emoji: "🔧",
      data: data.byCategory.utility,
      color: "bg-orange-500",
      description: "Notificaciones transaccionales y actualizaciones",
    },
  ]

  const totalCount = data.totalConversations

  return (
    <Card className="p-6">
      <h2 className="text-xl font-semibold mb-6">Conversaciones por Categoría</h2>
      <div className="space-y-6">
        {categories.map((category) => {
          const percentage = totalCount > 0 ? (category.data.count / totalCount) * 100 : 0

          return (
            <div key={category.name} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{category.emoji}</span>
                  <div>
                    <div className="font-medium">{category.name}</div>
                    <div className="text-xs text-muted-foreground">{category.description}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold">{formatNumber(category.data.count)} conversaciones</div>
                  <div className="text-sm text-muted-foreground">
                    {category.data.cost > 0 ? formatCurrency(category.data.cost) : "Gratis"}
                  </div>
                </div>
              </div>
              <div className="space-y-1">
                <Progress value={percentage} className="h-2" />
                <div className="text-xs text-muted-foreground text-right">{percentage.toFixed(1)}% del total</div>
              </div>
            </div>
          )
        })}
      </div>

      {data.totalCost === 0 && data.totalConversations > 0 && (
        <div className="mt-6 p-4 bg-muted rounded-lg">
          <p className="text-sm text-muted-foreground">
            Los costos no están disponibles. Esto puede ocurrir si tu cuenta factura a través de un Business Solution
            Provider (BSP) o si no tienes los permisos necesarios para ver información de facturación.
          </p>
        </div>
      )}
    </Card>
  )
}
