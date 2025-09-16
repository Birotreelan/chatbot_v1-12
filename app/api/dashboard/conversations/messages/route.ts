import { type NextRequest, NextResponse } from "next/server"
import { getConversationMessages } from "@/lib/db"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const configId = searchParams.get("configId")
    const phoneNumber = searchParams.get("phoneNumber")

    if (!configId || !phoneNumber) {
      return NextResponse.json({ success: false, error: "configId y phoneNumber son requeridos" }, { status: 400 })
    }

    const messages = await getConversationMessages(configId, phoneNumber)
    return NextResponse.json({ success: true, data: messages })
  } catch (error) {
    console.error("Error obteniendo mensajes:", error)
    return NextResponse.json({ success: false, error: "Error interno del servidor" }, { status: 500 })
  }
}
