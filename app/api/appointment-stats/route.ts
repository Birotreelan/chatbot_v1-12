import { NextResponse } from "next/server"
import { getAppointmentStatsByClienteId } from "@/lib/appointment-stats"
import { getAllWhatsAppConfigs } from "@/lib/db"

// GET - Obtener estadísticas por cliente_id o lista de todos los clientes con sus estadísticas
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const clienteId = searchParams.get("clienteId")

    // Si se especifica un cliente, devolver sus estadísticas
    if (clienteId) {
      const stats = await getAppointmentStatsByClienteId(clienteId)

      if (!stats) {
        return NextResponse.json({
          clienteId,
          clientName: "Sin datos",
          totalConfirmed: 0,
          totalCancelled: 0,
          totalRescheduled: 0,
          totalTemplatesSent: 0,
          confirmedByDay: {},
          cancelledByDay: {},
          rescheduledByDay: {},
          templatesSentByDay: {},
          confirmationRate: 0,
          cancellationRate: 0,
          responseRate: 0,
          avgResponseTime: 0,
          avgConfirmationTime: 0,
          avgCancellationTime: 0,
          lastUpdated: new Date().toISOString(),
        })
      }

      return NextResponse.json(stats)
    }

    // Si no se especifica cliente, devolver resumen de todos los clientes
    const configs = await getAllWhatsAppConfigs()
    const clientsWithStats = []

    for (const config of configs) {
      if (config.cliente_id) {
        const stats = await getAppointmentStatsByClienteId(config.cliente_id)
        clientsWithStats.push({
          configId: config.id,
          clienteId: config.cliente_id,
          displayName: config.displayName,
          stats: stats || {
            totalConfirmed: 0,
            totalCancelled: 0,
            totalRescheduled: 0,
            totalTemplatesSent: 0,
            confirmationRate: 0,
            cancellationRate: 0,
            responseRate: 0,
          },
        })
      }
    }

    return NextResponse.json(clientsWithStats)
  } catch (error) {
    console.error("[APPOINTMENT_STATS_API] Error:", error)
    return NextResponse.json({ error: "Error al obtener estadísticas" }, { status: 500 })
  }
}
