import { type NextRequest, NextResponse } from "next/server"
import { getConversationById } from "@/lib/db"
import { isAuthenticated } from "@/lib/auth"

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  // Verificar autenticación
  if (!isAuthenticated(request)) {
    return new Response("Unauthorized", { status: 401 })
  }

  try {
    const conversationId = decodeURIComponent(params.id)
    console.log(`[API] Obteniendo conversación: ${conversationId}`)

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

    console.log(`[API] ✅ Conversación obtenida: ${conversation.messages.length} mensajes`)

    return NextResponse.json({
      success: true,
      conversation,
    })
  } catch (error) {
    console.error("[API] ❌ Error obteniendo conversación:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Error interno del servidor",
        details: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}
