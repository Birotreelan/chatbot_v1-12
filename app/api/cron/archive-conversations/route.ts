import { NextResponse } from "next/server"
import { archiveInactiveConversations } from "@/lib/conversation-logger"

export async function POST() {
  try {
    console.log("[CRON] Iniciando archivado de conversaciones inactivas")

    const archivedCount = await archiveInactiveConversations()

    console.log(`[CRON] Archivadas ${archivedCount} conversaciones inactivas`)

    return NextResponse.json({
      success: true,
      message: `Archivadas ${archivedCount} conversaciones inactivas`,
      archivedCount,
    })
  } catch (error) {
    console.error("[CRON] Error archivando conversaciones:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}

// Permitir que la función se ejecute durante más tiempo
export const maxDuration = 60
