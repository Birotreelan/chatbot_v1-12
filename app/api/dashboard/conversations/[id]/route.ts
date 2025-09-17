import { type NextRequest, NextResponse } from "next/server"
import { getConversationMessages } from "@/lib/db"
import { isAuthenticated } from "@/lib/auth"

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    // Verificar autenticación
    const authenticated = await isAuthenticated(request)
    if (!authenticated) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const conversationId = params.id
    console.log(`[API] Obteniendo mensajes para conversación: ${conversationId}`)

    const messages = await getConversationMessages(conversationId)

    console.log(`[API] ✅ Mensajes obtenidos: ${messages.length}`)

    return NextResponse.json({
      success: true,
      data: messages,
      total: messages.length,
    })
  } catch (error) {
    console.error("[API] ❌ Error obteniendo mensajes de conversación:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error interno del servidor",
      },
      { status: 500 },
    )
  }
}
