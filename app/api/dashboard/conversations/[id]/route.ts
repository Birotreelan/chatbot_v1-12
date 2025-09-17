import { type NextRequest, NextResponse } from "next/server"
import { getConversationById } from "@/lib/db"
import { isAuthenticated } from "@/lib/auth"

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    // Verificar autenticación
    if (!isAuthenticated(request)) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const conversationId = params.id
    console.log(`[API] Obteniendo conversación: ${conversationId}`)

    const conversation = await getConversationById(conversationId)

    if (!conversation) {
      console.log(`[API] ❌ Conversación no encontrada: ${conversationId}`)
      return NextResponse.json({ success: false, error: "Conversación no encontrada" }, { status: 404 })
    }

    console.log(`[API] ✅ Conversación obtenida: ${conversationId} con ${conversation.messages.length} mensajes`)

    return NextResponse.json({
      success: true,
      data: conversation,
    })
  } catch (error) {
    console.error("[API] ❌ Error obteniendo conversación:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error interno del servidor",
      },
      { status: 500 },
    )
  }
}
