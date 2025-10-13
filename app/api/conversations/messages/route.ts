import { NextResponse } from "next/server"
import { getConversationMessages } from "@/lib/conversations"

export async function GET(request: Request) {
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
    console.error("[API] Error obteniendo mensajes:", error)
    return NextResponse.json({ error: "Error obteniendo mensajes" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"
