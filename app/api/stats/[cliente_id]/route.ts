import { NextResponse } from "next/server"
import { getAppointmentStatsByClienteId } from "@/lib/appointment-stats"
import { getConfigByClienteId } from "@/lib/db"

export async function GET(request: Request, { params }: { params: Promise<{ cliente_id: string }> }) {
  try {
    const { cliente_id } = await params

    console.log(`[STATS_API] Solicitando estadísticas para cliente_id: ${cliente_id}`)

    // Verificar que el cliente existe
    const config = await getConfigByClienteId(cliente_id)

    if (!config) {
      console.log(`[STATS_API] Cliente no encontrado: ${cliente_id}`)
      return NextResponse.json({ success: false, error: "Cliente no encontrado" }, { status: 404 })
    }

    console.log(`[STATS_API] Cliente encontrado: ${config.displayName} (ID: ${config.id})`)

    // Obtener estadísticas usando el ID de configuración
    const stats = await getAppointmentStatsByClienteId(config.id)

    if (!stats) {
      console.log(`[STATS_API] No hay estadísticas disponibles para cliente ${cliente_id}`)
      // Retornar estadísticas vacías en lugar de error
      return NextResponse.json({
        success: true,
        data: {
          clienteId: config.id,
          clientName: config.displayName,
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
        },
      })
    }

    console.log(`[STATS_API] Estadísticas obtenidas exitosamente para ${config.displayName}`)
    console.log(`[STATS_API] - Total confirmados: ${stats.totalConfirmed}`)
    console.log(`[STATS_API] - Total cancelados: ${stats.totalCancelled}`)
    console.log(`[STATS_API] - Total reprogramados: ${stats.totalRescheduled}`)
    console.log(`[STATS_API] - Total plantillas enviadas: ${stats.totalTemplatesSent}`)

    return NextResponse.json({
      success: true,
      data: stats,
    })
  } catch (error) {
    console.error("[STATS_API] Error al obtener estadísticas:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error al obtener estadísticas",
      },
      { status: 500 },
    )
  }
}

// Permitir CORS para embeds en iframes
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  })
}
