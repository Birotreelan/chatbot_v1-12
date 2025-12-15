import { NextResponse } from "next/server"
import { getSystemStats, getSystemStatsFiltered } from "@/lib/db"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get("startDate")
    const endDate = searchParams.get("endDate")

    // Si hay filtros de fecha, usar la función filtrada
    const stats =
      startDate || endDate
        ? await getSystemStatsFiltered(startDate || undefined, endDate || undefined)
        : await getSystemStats()

    return NextResponse.json(stats)
  } catch (error) {
    console.error("Error al obtener estadísticas:", error)
    return NextResponse.json(
      {
        totalConfigs: 0,
        activeConfigs: 0,
        totalMessages: 0,
        totalThreads: 0,
        lastUpdated: new Date().toISOString(),
      },
      { status: 500 },
    )
  }
}
