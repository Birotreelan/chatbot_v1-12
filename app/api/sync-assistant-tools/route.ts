import { type NextRequest, NextResponse } from "next/server"
import { syncAssistantTools } from "@/lib/openai-tools"

// API endpoint to manually sync tools with an assistant
export async function POST(request: NextRequest) {
  try {
    const { assistantId } = await request.json()

    if (!assistantId) {
      return NextResponse.json({ error: "assistantId is required" }, { status: 400 })
    }

    await syncAssistantTools(assistantId)

    return NextResponse.json({
      success: true,
      message: "Tools synced successfully",
    })
  } catch (error) {
    console.error("[API] Error syncing tools:", error)
    return NextResponse.json(
      {
        error: "Failed to sync tools",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
