import { NextResponse } from "next/server"
import { getConversationMessages, getConversationsByClient } from "@/lib/db"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const clienteId = searchParams.get("clienteId")
    const configId = searchParams.get("configId")
    const phoneNumber = searchParams.get("phoneNumber")

    console.log(`[API] 📋 Parámetros recibidos:`, { clienteId, configId, phoneNumber })

    if (clienteId && !configId && !phoneNumber) {
      // Obtener conversaciones por cliente
      console.log(`[API] 📋 Obteniendo conversaciones para cliente: ${clienteId}`)
      const conversations = await getConversationsByClient(clienteId)

      return NextResponse.json({
        success: true,
        data: conversations,
      })
    } else if (configId && phoneNumber) {
      // Obtener mensajes de una conversación específica
      console.log(`[API] 💬 Obteniendo mensajes para ${phoneNumber} en config ${configId}`)
      const messages = await getConversationMessages(configId, phoneNumber)

      return NextResponse.json({
        success: true,
        data: messages,
      })
    } else {
      return NextResponse.json(
        {
          success: false,
          error: "Parámetros inválidos. Se requiere clienteId o (configId + phoneNumber)",
        },
        { status: 400 },
      )
    }
  } catch (error) {
    console.error("[API] ❌ Error obteniendo datos:", error)

    return NextResponse.json(
      {
        success: false,
        error: "Error interno del servidor",
      },
      { status: 500 },
    )
  }
}
