import { type NextRequest, NextResponse } from "next/server"
import { getAllConversations, getConversationsByClient, getAllWhatsAppConfigs } from "@/lib/db"
import { requireAuth } from "@/lib/auth"

export async function GET(request: NextRequest) {
  try {
    // Verificar autenticación
    await requireAuth()

    const { searchParams } = new URL(request.url)
    const clienteId = searchParams.get("cliente_id")

    let conversations
    if (clienteId) {
      conversations = await getConversationsByClient(clienteId)
    } else {
      conversations = await getAllConversations()
    }

    // Obtener configuraciones para mapear nombres de clientes
    const configs = await getAllWhatsAppConfigs()
    const configMap = new Map(configs.map((config) => [config.cliente_id, config.displayName]))

    // Enriquecer conversaciones con nombres de clientes
    const enrichedConversations = conversations.map((conv) => ({
      ...conv,
      clienteName: configMap.get(conv.clienteName) || conv.clienteName,
    }))

    return NextResponse.json({
      success: true,
      data: enrichedConversations,
    })
  } catch (error) {
    console.error("Error obteniendo conversaciones:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}
