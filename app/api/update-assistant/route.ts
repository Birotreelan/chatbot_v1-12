import { NextResponse } from "next/server"
import { configureAssistant } from "@/lib/assistant-config"

export async function POST() {
  try {
    // Actualizar el asistente con las nuevas instrucciones
    const assistantId = await configureAssistant()

    return NextResponse.json({
      success: true,
      message: "Asistente actualizado correctamente",
      assistantId,
    })
  } catch (error) {
    console.error("Error al actualizar el asistente:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido al actualizar el asistente",
      },
      { status: 500 },
    )
  }
}
