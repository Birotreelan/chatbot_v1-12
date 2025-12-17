"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts"
import type { ClientAppointmentStats } from "@/lib/types"

interface ResponseTimeChartProps {
  stats: ClientAppointmentStats
}

export function ResponseTimeChart({ stats }: ResponseTimeChartProps) {
  // Preparar datos para el gráfico de plantillas enviadas
  const chartData = []
  const today = new Date()
  const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))

  for (let i = 29; i >= 0; i--) {
    const date = new Date(todayUTC)
    date.setUTCDate(date.getUTCDate() - i)
    const dateStr = date.toISOString().split("T")[0]

    chartData.push({
      date: dateStr,
      displayDate: `${date.getUTCDate()}/${date.getUTCMonth() + 1}`,
      enviadas: Number(stats.templatesSentByDay[dateStr]) || 0,
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plantillas Enviadas</CardTitle>
        <CardDescription>Recordatorios de turnos enviados por día (últimos 30 días)</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={{
            enviadas: {
              label: "Plantillas Enviadas",
              color: "hsl(217, 91%, 60%)",
            },
          }}
          className="h-[300px]"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorEnviadas" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-enviadas)" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="var(--color-enviadas)" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="displayDate" fontSize={12} />
              <YAxis fontSize={12} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area
                type="monotone"
                dataKey="enviadas"
                stroke="var(--color-enviadas)"
                fillOpacity={1}
                fill="url(#colorEnviadas)"
                name="Plantillas Enviadas"
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
