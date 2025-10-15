import { NextResponse } from "next/server"
import { pauseConversation } from "@/lib/conversations"

export async function POST(request: Request) {
  try {
    const { configId, phoneNumber } = await request.json()

    console.log("[API] POST /api/conversations/pause")
    console.log("[API]   - configId:", configId)
    console.log("[API]   - phoneNumber:", phoneNumber)

    if (!configId || !phoneNumber) {
      return NextResponse.json({ error: "configId y phoneNumber son requeridos" }, { status: 400 })
    }

    await pauseConversation(configId, phoneNumber)

    console.log("[API] ✅ Conversación pausada exitosamente")

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[API] ❌ Error pausando conversación:", error)
    return NextResponse.json({ error: "Error pausando conversación" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"
