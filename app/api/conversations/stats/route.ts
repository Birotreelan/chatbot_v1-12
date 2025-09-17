import { NextResponse } from "next/server"
import { getConversationStats } from "@/lib/conversation-logger"

export async function GET() {
  try {
    const stats = await getConversationStats()

    return NextResponse.json({
      success: true,
      stats,
    })
  } catch (error) {
    console.error("Error fetching conversation stats:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}
