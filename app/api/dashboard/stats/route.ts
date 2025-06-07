import { NextResponse } from "next/server"
import { getSystemStats } from "@/lib/db"

export async function GET() {
  try {
    const stats = await getSystemStats()
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
