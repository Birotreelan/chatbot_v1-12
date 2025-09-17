import { NextResponse } from "next/server"
import { getAllConversations } from "@/lib/conversation-logger"

export async function GET() {
  try {
    const conversations = await getAllConversations()

    // Ordenar por última actividad (más recientes primero)
    const sortedConversations = conversations.sort(
      (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
    )

    return NextResponse.json({
      success: true,
      conversations: sortedConversations,
    })
  } catch (error) {
    console.error("Error fetching conversations:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}
