import { NextResponse } from "next/server"
import { isConversationPaused, setConversationPaused } from "@/lib/conversations"

export async function POST(request: Request) {
  try {
    const { configId, phoneNumber } = await request.json()

    if (!configId) {
      return NextResponse.json({ error: "Config ID es requerido" }, { status: 400 })
    }

    if (!phoneNumber) {
      return NextResponse.json({ error: "Phone number es requerido para pausar una conversación" }, { status: 400 })
    }

    // Obtener estado actual de la conversación
    const currentlyPaused = await isConversationPaused(configId, phoneNumber)
    const newPausedState = !currentlyPaused

    // Cambiar estado de pausa
    const success = await setConversationPaused(configId, phoneNumber, newPausedState)

    if (!success) {
      return NextResponse.json({ error: "Error al cambiar estado de pausa" }, { status: 500 })
    }

    console.log(`[API] IA ${newPausedState ? "pausada" : "reanudada"} para conversación ${configId}:${phoneNumber}`)

    return NextResponse.json({
      success: true,
      paused: newPausedState,
      phoneNumber,
      message: newPausedState ? "IA pausada para esta conversación" : "IA reanudada para esta conversación",
    })
  } catch (error) {
    console.error("[API] Error al cambiar estado de pausa:", error)
    return NextResponse.json({ error: "Error al cambiar estado de pausa" }, { status: 500 })
  }
}
