import { NextResponse } from "next/server"
import { getClientMessages } from "@/lib/db"
import { getSession } from "@/lib/auth"

export async function GET(request: Request) {
  try {
    // Verificar autenticación
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const clientId = searchParams.get("clientId")

    if (!clientId) {
      return NextResponse.json({ success: false, error: "clientId es requerido" }, { status: 400 })
    }

    console.log(`[API] 📨 Obteniendo mensajes para cliente: ${clientId}`)

    const messages = await getClientMessages(clientId)

    console.log(`[API] ✅ Encontrados ${messages.length} mensajes`)

    return NextResponse.json({
      success: true,
      data: messages,
    })
  } catch (error) {
    console.error("[API] ❌ Error obteniendo mensajes:", error)

    return NextResponse.json(
      {
        success: false,
        error: "Error interno del servidor",
      },
      { status: 500 },
    )
  }
}
