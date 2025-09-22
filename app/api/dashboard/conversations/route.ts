import { type NextRequest, NextResponse } from "next/server"
import { getAllConversations, getConversationsByClient } from "@/lib/db"
import { isAuthenticated } from "@/lib/auth"

export async function GET(request: NextRequest) {
  // Verificar autenticación
  if (!isAuthenticated(request)) {
    return new Response("Unauthorized", { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const clienteId = searchParams.get("cliente_id")
    const search = searchParams.get("search")

    console.log(`[API] Obteniendo conversaciones - Cliente: ${clienteId}, Búsqueda: ${search}`)

    let conversations = clienteId ? await getConversationsByClient(clienteId) : await getAllConversations()

    // Filtrar por búsqueda si se proporciona
    if (search) {
      const searchLower = search.toLowerCase()
      conversations = conversations.filter(
        (conv) =>
          conv.userName.toLowerCase().includes(searchLower) ||
          conv.phoneNumber.includes(search) ||
          conv.lastMessage.toLowerCase().includes(searchLower),
      )
    }

    console.log(`[API] ✅ ${conversations.length} conversaciones obtenidas`)

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
        error: "Error interno del servidor",
        details: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}
