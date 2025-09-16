import { type NextRequest, NextResponse } from "next/server"
import { getAllClientsWithConversations, getConversationsByClient } from "@/lib/db"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const clienteId = searchParams.get("clienteId")

    if (clienteId) {
      // Obtener conversaciones de un cliente específico
      const conversations = await getConversationsByClient(clienteId)
      return NextResponse.json({ success: true, data: conversations })
    } else {
      // Obtener todos los clientes con sus estadísticas de conversaciones
      const clients = await getAllClientsWithConversations()
      return NextResponse.json({ success: true, data: clients })
    }
  } catch (error) {
    console.error("Error obteniendo conversaciones:", error)
    return NextResponse.json({ success: false, error: "Error interno del servidor" }, { status: 500 })
  }
}
