import { NextResponse } from "next/server"
import { getConversationsByClient, getConversationMessages } from "@/lib/db"
import { isAuthenticated } from "@/lib/auth"

export async function GET(request: Request) {
  try {
    // Verificar autenticación
    if (!isAuthenticated(request)) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const clienteId = searchParams.get("clienteId")
    const configId = searchParams.get("configId")
    const phoneNumber = searchParams.get("phoneNumber")

    if (clienteId && !configId && !phoneNumber) {
      // Obtener conversaciones de un cliente
      console.log(`[API] Obteniendo conversaciones para cliente: ${clienteId}`)
      const conversations = await getConversationsByClient(clienteId)

      return NextResponse.json({
        success: true,
        conversations,
      })
    } else if (configId && phoneNumber) {
      // Obtener mensajes de una conversación específica
      console.log(`[API] Obteniendo mensajes para ${phoneNumber} en config ${configId}`)
      const messages = await getConversationMessages(configId, phoneNumber)

      return NextResponse.json({
        success: true,
        messages,
      })
    } else {
      return NextResponse.json({ success: false, error: "Parámetros inválidos" }, { status: 400 })
    }
  } catch (error) {
    console.error("[API] Error obteniendo mensajes:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}
