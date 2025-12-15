import { notFound } from "next/navigation"
import { getConfigByClienteId } from "@/lib/db"
import { getAppointmentStatsByClienteId } from "@/lib/appointment-stats"
import { AppointmentStatsView } from "@/components/stats/appointment-stats-view"

export default async function ClientStatsPage({
  params,
}: {
  params: Promise<{ cliente_id: string }>
}) {
  const { cliente_id } = await params

  console.log(`[STATS_PAGE] Accediendo a estadísticas para cliente_id: ${cliente_id}`)

  // Verificar que el cliente existe
  const config = await getConfigByClienteId(cliente_id)

  if (!config) {
    console.log(`[STATS_PAGE] Cliente no encontrado: ${cliente_id}`)
    notFound()
  }

  console.log(`[STATS_PAGE] Cliente encontrado: ${config.displayName}`)

  const initialStats = await getAppointmentStatsByClienteId(cliente_id)

  return (
    <div className="min-h-screen bg-background">
      <AppointmentStatsView clienteId={cliente_id} clientName={config.displayName} initialStats={initialStats} />
    </div>
  )
}

// Desactivar generación estática
export const dynamic = "force-dynamic"
