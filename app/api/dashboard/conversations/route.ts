import { type NextRequest, NextResponse } from "next/server"
import { isAuthenticated } from "@/lib/auth"
import { getAllConversations, getConversationsByClient } from "@/lib/db"

export async function GET(request: NextRequest) {
  try {
    // Verificar autenticación
    if (!isAuthenticated(request)) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const clienteId = searchParams.get("clienteId")

    console.log(`[API] 🔍 Obteniendo conversaciones${clienteId ? ` para cliente: ${clienteId}` : ""}`)

    let conversations
    if (clienteId) {
      conversations = await getConversationsByClient(clienteId)
    } else {
      conversations = await getAllConversations()
    }

    console.log(`[API] ✅ ${conversations.length} conversaciones encontradas`)

    return NextResponse.json({
      success: true,
      conversations,
      total: conversations.length,
    })
  } catch (error) {
    console.error("[API] ❌ Error obteniendo conversaciones:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}
