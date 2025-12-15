import { NextResponse } from "next/server"
import { isConversationPaused } from "@/lib/conversations"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const configId = searchParams.get("configId")
    const phoneNumber = searchParams.get("phoneNumber")

    if (!configId || !phoneNumber) {
      return NextResponse.json({ error: "configId y phoneNumber son requeridos" }, { status: 400 })
    }

    const paused = await isConversationPaused(configId, phoneNumber)

    return NextResponse.json({
      paused,
      configId,
      phoneNumber,
    })
  } catch (error) {
    console.error("[API] Error obteniendo estado de pausa:", error)
    return NextResponse.json({ error: "Error obteniendo estado de pausa" }, { status: 500 })
  }
}
