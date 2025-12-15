import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { SystemStats } from "@/lib/types"

interface DashboardStatsProps {
  stats: SystemStats
}

export function DashboardStats({ stats }: DashboardStatsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total de Configuraciones</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.totalConfigs}</div>
          <p className="text-xs text-muted-foreground">{stats.activeConfigs} activas</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total de Mensajes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.totalMessages}</div>
          <p className="text-xs text-muted-foreground">En {stats.totalThreads} conversaciones</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Conversaciones</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.totalThreads}</div>
          <p className="text-xs text-muted-foreground">Activas con usuarios</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Última Actualización</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{new Date(stats.lastUpdated).toLocaleTimeString()}</div>
          <p className="text-xs text-muted-foreground">{new Date(stats.lastUpdated).toLocaleDateString()}</p>
        </CardContent>
      </Card>
    </div>
  )
}
