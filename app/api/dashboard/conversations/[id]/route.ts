import { type NextRequest, NextResponse } from "next/server"
import { getConversationById } from "@/lib/db"
import { requireAuth } from "@/lib/auth"

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    // Verificar autenticación
    await requireAuth()

    const conversationId = params.id
    const conversation = await getConversationById(conversationId)

    if (!conversation) {
      return NextResponse.json(
        {
          success: false,
          error: "Conversación no encontrada",
        },
        { status: 404 },
      )
    }

    return NextResponse.json({
      success: true,
      data: conversation,
    })
  } catch (error) {
    console.error("Error obteniendo conversación:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}
