import { Suspense } from "react"
import { MonitoringStats } from "@/components/dashboard/monitoring-stats"
import { ErrorLog } from "@/components/dashboard/error-log"
import { RefreshButton } from "@/components/dashboard/refresh-button"

export default function MonitoringPage() {
  return (
    <div className="container mx-auto py-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Monitoreo del Sistema</h1>
        <RefreshButton />
      </div>

      <Suspense fallback={<div className="p-4 border rounded-md">Cargando estadísticas...</div>}>
        <MonitoringStats />
      </Suspense>

      <h2 className="text-2xl font-bold mt-8 mb-4">Registro de Errores</h2>

      <Suspense fallback={<div className="p-4 border rounded-md">Cargando errores...</div>}>
        <ErrorLog />
      </Suspense>
    </div>
  )
}

export const dynamic = "force-dynamic"
