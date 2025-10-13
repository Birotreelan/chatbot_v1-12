import { NextResponse } from "next/server"
import { getConversationMessages } from "@/lib/conversations"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const configId = searchParams.get("configId")
    const phoneNumber = searchParams.get("phoneNumber")

    console.log("[API] 📨 GET /api/conversations/messages")
    console.log("[API]   - configId:", configId)
    console.log("[API]   - phoneNumber:", phoneNumber)

    if (!configId || !phoneNumber) {
      console.log("[API] ❌ Parámetros faltantes")
      return NextResponse.json({ error: "configId y phoneNumber son requeridos" }, { status: 400 })
    }

    console.log("[API] 🔍 Llamando a getConversationMessages...")
    const messages = await getConversationMessages(configId, phoneNumber)

    console.log("[API] ✅ Mensajes obtenidos:", messages.length)

    if (messages.length > 0) {
      console.log("[API] 📝 Primer mensaje:", {
        role: messages[0].role,
        timestamp: messages[0].timestamp,
        contentLength: messages[0].content?.length || 0,
      })
      console.log("[API] 📝 Último mensaje:", {
        role: messages[messages.length - 1].role,
        timestamp: messages[messages.length - 1].timestamp,
        contentLength: messages[messages.length - 1].content?.length || 0,
      })
    }

    return NextResponse.json({ messages })
  } catch (error) {
    console.error("[API] ❌ Error obteniendo mensajes:", error)
    return NextResponse.json({ error: "Error obteniendo mensajes" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"
