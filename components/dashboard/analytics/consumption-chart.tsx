"use client"

import { Card } from "@/components/ui/card"
import type { ConsumptionSummary } from "@/lib/types"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"

interface ConsumptionChartProps {
  data: ConsumptionSummary
}

export function ConsumptionChart({ data }: ConsumptionChartProps) {
  // Preparar datos para el gráfico
  const chartData = [
    {
      category: "Authentication",
      conversaciones: data.byCategory.authentication.count,
      costo: data.byCategory.authentication.cost,
    },
    {
      category: "Marketing",
      conversaciones: data.byCategory.marketing.count,
      costo: data.byCategory.marketing.cost,
    },
    {
      category: "Service",
      conversaciones: data.byCategory.service.count,
      costo: data.byCategory.service.cost,
    },
    {
      category: "Utility",
      conversaciones: data.byCategory.utility.count,
      costo: data.byCategory.utility.cost,
    },
  ]

  return (
    <Card className="p-6">
      <h2 className="text-xl font-semibold mb-6">Distribución de Conversaciones</h2>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="category" />
          <YAxis yAxisId="left" orientation="left" stroke="#8884d8" />
          <YAxis yAxisId="right" orientation="right" stroke="#82ca9d" />
          <Tooltip />
          <Legend />
          <Bar yAxisId="left" dataKey="conversaciones" fill="#8884d8" name="Conversaciones" />
          <Bar yAxisId="right" dataKey="costo" fill="#82ca9d" name="Costo (USD)" />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  )
}
