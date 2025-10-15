import { NextResponse } from "next/server"
import { resumeConversation } from "@/lib/conversations"

export async function POST(request: Request) {
  try {
    const { configId, phoneNumber } = await request.json()

    console.log("[API] 🔵 POST /api/conversations/resume")
    console.log("[API]   - configId:", configId)
    console.log("[API]   - phoneNumber:", phoneNumber)

    if (!configId || !phoneNumber) {
      return NextResponse.json({ error: "configId y phoneNumber son requeridos" }, { status: 400 })
    }

    await resumeConversation(configId, phoneNumber)

    console.log("[API] 🟢 Conversación reanudada exitosamente")

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[API] 🔴 Error reanudando conversación:", error)
    return NextResponse.json({ error: "Error reanudando conversación" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"
