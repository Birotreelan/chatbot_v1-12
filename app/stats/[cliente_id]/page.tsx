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

  // Obtener estadísticas usando el cliente_id
  let initialStats = await getAppointmentStatsByClienteId(cliente_id)

  // Fallback: buscar con config.id para datos históricos que fueron guardados con ese ID
  if (!initialStats && config.id !== cliente_id) {
    console.log(`[STATS_PAGE] No hay estadísticas con cliente_id, intentando con config.id: ${config.id}`)
    initialStats = await getAppointmentStatsByClienteId(config.id)
    
    // Si encontramos stats con config.id, normalizar el clienteId al cliente_id correcto
    if (initialStats) {
      console.log(`[STATS_PAGE] Estadísticas encontradas con config.id, normalizando a cliente_id`)
      initialStats = {
        ...initialStats,
        clienteId: cliente_id,
      }
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <AppointmentStatsView clienteId={cliente_id} clientName={config.displayName} initialStats={initialStats} />
    </div>
  )
}

// Desactivar generación estática
export const dynamic = "force-dynamic"
