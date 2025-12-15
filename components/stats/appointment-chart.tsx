"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, XAxis, YAxis } from "recharts"
import type { ClientAppointmentStats } from "@/lib/types"

interface AppointmentChartProps {
  stats: ClientAppointmentStats
}

export function AppointmentChart({ stats }: AppointmentChartProps) {
  // Preparar datos para el gráfico (últimos 30 días)
  const chartData = []
  const today = new Date()

  for (let i = 29; i >= 0; i--) {
    const date = new Date(today)
    date.setDate(date.getDate() - i)
    const dateStr = date.toISOString().split("T")[0]

    chartData.push({
      date: dateStr,
      displayDate: `${date.getDate()}/${date.getMonth() + 1}`,
      confirmados: Number(stats.confirmedByDay[dateStr]) || 0,
      cancelados: Number(stats.cancelledByDay[dateStr]) || 0,
      reprogramados: Number(stats.rescheduledByDay[dateStr]) || 0,
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Evolución de Turnos</CardTitle>
        <CardDescription>Confirmaciones, cancelaciones y reprogramaciones por día (últimos 30 días)</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={{
            confirmados: {
              label: "Confirmados",
              color: "hsl(142, 76%, 36%)",
            },
            cancelados: {
              label: "Cancelados",
              color: "hsl(0, 84%, 60%)",
            },
            reprogramados: {
              label: "Reprogramados",
              color: "hsl(217, 91%, 60%)",
            },
          }}
          className="h-[300px]"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="displayDate" fontSize={12} />
              <YAxis fontSize={12} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Legend />
              <Bar dataKey="confirmados" fill="var(--color-confirmados)" name="Confirmados" radius={[4, 4, 0, 0]} />
              <Bar dataKey="cancelados" fill="var(--color-cancelados)" name="Cancelados" radius={[4, 4, 0, 0]} />
              <Bar
                dataKey="reprogramados"
                fill="var(--color-reprogramados)"
                name="Reprogramados"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
