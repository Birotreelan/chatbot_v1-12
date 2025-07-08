import { type NextRequest, NextResponse } from "next/server"
import { previewSystemPrompt } from "@/lib/system-prompts"
import { checkAuth } from "@/lib/auth"

export async function GET(request: NextRequest) {
  try {
    const authResult = await checkAuth()
    if (!authResult.success) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const clienteId = searchParams.get("clienteId")
    const channel = (searchParams.get("channel") as "whatsapp" | "widget") || "whatsapp"

    if (!clienteId) {
      return NextResponse.json({ error: "clienteId es requerido" }, { status: 400 })
    }

    const preview = await previewSystemPrompt(clienteId, channel)
    return NextResponse.json({ preview })
  } catch (error) {
    console.error("[API] Error generando preview del prompt:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
