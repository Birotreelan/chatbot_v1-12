import { NextResponse } from "next/server"
import { getAllWhatsAppConfigs, getClientConversations, getConversationStats } from "@/lib/db"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const clienteId = searchParams.get("cliente_id")

    if (clienteId) {
      // Obtener conversaciones de un cliente específico
      const conversations = await getClientConversations(clienteId)
      const stats = await getConversationStats()

      return NextResponse.json({
        success: true,
        conversations,
        stats,
      })
    } else {
      // Obtener todos los clientes con sus configuraciones
      const configs = await getAllWhatsAppConfigs()

      // Agrupar por cliente_id
      const clientsMap = new Map()

      for (const config of configs) {
        const clienteId = config.cliente_id || "sin_cliente"

        if (!clientsMap.has(clienteId)) {
          clientsMap.set(clienteId, {
            cliente_id: clienteId,
            displayName: config.displayName,
            configs: [],
            totalConversations: 0,
            totalMessages: 0,
            activeConversations: 0,
          })
        }

        const client = clientsMap.get(clienteId)
        client.configs.push(config)

        // Obtener estadísticas para esta configuración
        const configStats = await getConversationStats(config.id)
        client.totalConversations += configStats.totalConversations
        client.totalMessages += configStats.totalMessages
        client.activeConversations += configStats.activeConversations
      }

      const clients = Array.from(clientsMap.values())

      return NextResponse.json({
        success: true,
        clients,
      })
    }
  } catch (error) {
    console.error("Error al obtener conversaciones:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}

export const dynamic = "force-dynamic"
