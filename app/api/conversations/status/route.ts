import { NextResponse } from "next/server"
import { isConversationPaused } from "@/lib/conversations"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const configId = searchParams.get("configId")
    const phoneNumber = searchParams.get("phoneNumber")

    console.log("[API] 🔵 GET /api/conversations/status")
    console.log("[API]   - configId:", configId)
    console.log("[API]   - phoneNumber:", phoneNumber)

    if (!configId || !phoneNumber) {
      return NextResponse.json({ error: "configId y phoneNumber son requeridos" }, { status: 400 })
    }

    const isPaused = await isConversationPaused(configId, phoneNumber)

    console.log("[API]   - isPaused result:", isPaused)
    console.log("[API] 🟢 Estado obtenido exitosamente")

    return NextResponse.json({ isPaused })
  } catch (error) {
    console.error("[API] 🔴 Error obteniendo estado de conversación:", error)
    return NextResponse.json({ error: "Error obteniendo estado" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"
