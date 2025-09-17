import { NextResponse } from "next/server"
import { getConversationMessages } from "@/lib/conversation-logger"

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const conversationId = params.id
    const messages = await getConversationMessages(conversationId)

    return NextResponse.json({
      success: true,
      messages,
    })
  } catch (error) {
    console.error("Error fetching conversation messages:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}
