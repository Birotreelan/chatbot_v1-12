import { NextResponse } from "next/server"
import { getConversationMessages, getAllConversationMessages } from "@/lib/conversations"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const configId = searchParams.get("configId")
    const phoneNumber = searchParams.get("phoneNumber")
    const limit = parseInt(searchParams.get("limit") || "50", 10)
    const offset = parseInt(searchParams.get("offset") || "0", 10)

    console.log("[API] GET /api/conversations/messages")
    console.log("[API]   - configId:", configId)
    console.log("[API]   - phoneNumber:", phoneNumber)
    console.log("[API]   - limit:", limit, "offset:", offset)

    if (!configId || !phoneNumber) {
      console.log("[API] Parametros faltantes")
      return NextResponse.json({ error: "configId y phoneNumber son requeridos" }, { status: 400 })
    }

    console.log("[API] Llamando a getConversationMessages...")
    const { messages, total, hasMore } = await getConversationMessages(configId, phoneNumber, limit, offset)

    console.log("[API] Mensajes obtenidos:", messages.length, "de", total, "total")

    return NextResponse.json({ messages, total, hasMore })
  } catch (error) {
    console.error("[API] Error obteniendo mensajes:", error)
    return NextResponse.json({ error: "Error obteniendo mensajes" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"
