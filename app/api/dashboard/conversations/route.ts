import { NextResponse } from "next/server"
import { getAllClientsWithConversations } from "@/lib/db"
import { getSession } from "@/lib/auth"

export async function GET() {
  try {
    // Verificar autenticación
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    console.log("[API] 📋 Obteniendo clientes con conversaciones")

    const clients = await getAllClientsWithConversations()

    console.log(`[API] ✅ Encontrados ${clients.length} clientes`)

    return NextResponse.json({
      success: true,
      data: clients,
    })
  } catch (error) {
    console.error("[API] ❌ Error obteniendo clientes:", error)

    return NextResponse.json(
      {
        success: false,
        error: "Error interno del servidor",
      },
      { status: 500 },
    )
  }
}
