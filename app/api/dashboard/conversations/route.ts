import { type NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { getAllClients, getConversationsByClient } from "@/lib/db"

export async function GET(request: NextRequest) {
  try {
    // Verificar autenticación
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const clienteId = searchParams.get("clienteId")

    if (clienteId) {
      // Obtener conversaciones para un cliente específico
      console.log(`[API] Obteniendo conversaciones para cliente: ${clienteId}`)

      const conversations = await getConversationsByClient(clienteId)

      console.log(`[API] ✅ ${conversations.length} conversaciones encontradas`)

      return NextResponse.json({
        success: true,
        conversations,
      })
    } else {
      // Obtener lista de clientes
      console.log(`[API] Obteniendo lista de clientes`)

      const clients = await getAllClients()

      console.log(`[API] ✅ ${clients.length} clientes encontrados`)

      return NextResponse.json({
        success: true,
        clients,
      })
    }
  } catch (error) {
    console.error("[API] Error en /api/dashboard/conversations:", error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error interno del servidor",
      },
      { status: 500 },
    )
  }
}
