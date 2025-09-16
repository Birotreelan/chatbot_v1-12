import { type NextRequest, NextResponse } from "next/server"
import { getConversationMessages } from "@/lib/db"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const configId = searchParams.get("config_id")
    const phoneNumber = searchParams.get("phone_number")

    if (!configId || !phoneNumber) {
      return NextResponse.json({ error: "config_id y phone_number son requeridos" }, { status: 400 })
    }

    const messages = await getConversationMessages(configId, phoneNumber)
    return NextResponse.json({ messages })
  } catch (error) {
    console.error("Error en API messages:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
