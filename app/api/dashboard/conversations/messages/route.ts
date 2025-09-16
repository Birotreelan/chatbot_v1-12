import { type NextRequest, NextResponse } from "next/server"
import { getConversationMessages } from "@/lib/db"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const configId = searchParams.get("configId")
    const phoneNumber = searchParams.get("phoneNumber")

    if (!configId || !phoneNumber) {
      return NextResponse.json({ error: "configId y phoneNumber son requeridos" }, { status: 400 })
    }

    const messages = await getConversationMessages(configId, phoneNumber)
    return NextResponse.json({ messages })
  } catch (error) {
    console.error("[API] Error en /api/dashboard/conversations/messages:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
