import { type NextRequest, NextResponse } from "next/server"
import { getConversationsByClient, getAllConversations, getAllWhatsAppConfigs } from "@/lib/db"
import { isAuthenticated } from "@/lib/auth"

export async function GET(request: NextRequest) {
  try {
    // Verificar autenticación
    const authenticated = await isAuthenticated(request)
    if (!authenticated) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const clienteId = searchParams.get("cliente_id")
    const search = searchParams.get("search")

    console.log(`[API] Obteniendo conversaciones - Cliente: ${clienteId}, Búsqueda: ${search}`)

    let conversations

    if (clienteId) {
      // Obtener conversaciones por cliente
      conversations = await getConversationsByClient(clienteId)
    } else {
      // Obtener todas las conversaciones
      conversations = await getAllConversations()
    }

    // Aplicar filtro de búsqueda si se proporciona
    if (search && search.trim()) {
      const searchLower = search.toLowerCase().trim()
      conversations = conversations.filter(
        (conv) =>
          conv.userName.toLowerCase().includes(searchLower) ||
          conv.phoneNumber.includes(searchLower) ||
          conv.lastMessage.toLowerCase().includes(searchLower) ||
          conv.clienteName.toLowerCase().includes(searchLower),
      )
    }

    // Obtener configuraciones para mapear nombres de clientes
    const configs = await getAllWhatsAppConfigs()
    const configMap = new Map(configs.map((config) => [config.cliente_id, config.displayName]))

    // Enriquecer conversaciones con nombres de clientes actualizados
    const enrichedConversations = conversations.map((conv) => ({
      ...conv,
      clienteName: configMap.get(conv.clienteId) || conv.clienteName,
    }))

    console.log(`[API] ✅ Conversaciones obtenidas: ${enrichedConversations.length}`)

    return NextResponse.json({
      success: true,
      data: enrichedConversations,
      total: enrichedConversations.length,
    })
  } catch (error) {
    console.error("[API] ❌ Error obteniendo conversaciones:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error interno del servidor",
      },
      { status: 500 },
    )
  }
}
