import { NextResponse } from "next/server"
import { getAllClientsWithConversations } from "@/lib/db"
import { isAuthenticated } from "@/lib/auth"

export async function GET(request: Request) {
  try {
    // Verificar autenticación
    if (!isAuthenticated(request)) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    console.log("[API] Obteniendo clientes con conversaciones...")

    // Obtener todos los clientes con sus conversaciones
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
