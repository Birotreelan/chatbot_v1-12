import { type NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { getConversationMessages } from "@/lib/db"

export async function GET(request: NextRequest) {
  try {
    // Verificar autenticación
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const phoneNumber = searchParams.get("phoneNumber")
    const configId = searchParams.get("configId")

    if (!phoneNumber || !configId) {
      return NextResponse.json(
        {
          success: false,
          error: "phoneNumber y configId son requeridos",
        },
        { status: 400 },
      )
    }

    console.log(`[API] Obteniendo mensajes para conversación: ${phoneNumber} - ${configId}`)

    const messages = await getConversationMessages(phoneNumber, configId)

    console.log(`[API] ✅ ${messages.length} mensajes encontrados`)

    return NextResponse.json({
      success: true,
      messages,
    })
  } catch (error) {
    console.error("[API] Error en /api/dashboard/conversations/messages:", error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error interno del servidor",
      },
      { status: 500 },
    )
  }
}
