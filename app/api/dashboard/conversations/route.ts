import { type NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { getAllClientsWithConversations } from "@/lib/db"

export async function GET(request: NextRequest) {
  try {
    console.log("[API] Obteniendo conversaciones...")

    // Verificar autenticación
    const session = await getSession()
    if (!session) {
      console.log("[API] Usuario no autenticado")
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    console.log("[API] Usuario autenticado, obteniendo clientes...")

    // Obtener todos los clientes con conversaciones
    const clients = await getAllClientsWithConversations()

    console.log(`[API] Encontrados ${clients.length} clientes`)

    return NextResponse.json({
      success: true,
      clients,
    })
  } catch (error) {
    console.error("[API] Error obteniendo conversaciones:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}
