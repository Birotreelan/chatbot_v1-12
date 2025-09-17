import { type NextRequest, NextResponse } from "next/server"
import { isAuthenticated } from "@/lib/auth"
import { getConversationMessages } from "@/lib/db"

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    // Verificar autenticación
    if (!isAuthenticated(request)) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const conversationId = params.id
    console.log(`[API] 🔍 Obteniendo mensajes para conversación: ${conversationId}`)

    const messages = await getConversationMessages(conversationId)

    console.log(`[API] ✅ ${messages.length} mensajes encontrados`)

    return NextResponse.json({
      success: true,
      messages,
      total: messages.length,
    })
  } catch (error) {
    console.error("[API] ❌ Error obteniendo mensajes de conversación:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}
