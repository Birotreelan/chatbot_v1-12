import { NextResponse } from "next/server"
import { getWhatsAppConfig, updateWhatsAppConfig } from "@/lib/db"

export async function POST(request: Request) {
  try {
    const { configId } = await request.json()

    if (!configId) {
      return NextResponse.json({ error: "Config ID es requerido" }, { status: 400 })
    }

    // Get current config
    const config = await getWhatsAppConfig(configId)
    if (!config) {
      return NextResponse.json({ error: "Configuración no encontrada" }, { status: 404 })
    }

    // Toggle paused state
    const newPausedState = !config.paused
    await updateWhatsAppConfig(configId, { paused: newPausedState })

    console.log(`[API] IA ${newPausedState ? "pausada" : "reanudada"} para config ${configId}`)

    return NextResponse.json({
      success: true,
      paused: newPausedState,
      message: newPausedState ? "IA pausada exitosamente" : "IA reanudada exitosamente",
    })
  } catch (error) {
    console.error("[API] Error al cambiar estado de pausa:", error)
    return NextResponse.json({ error: "Error al cambiar estado de pausa" }, { status: 500 })
  }
}
