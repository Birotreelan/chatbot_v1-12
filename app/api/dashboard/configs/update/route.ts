import { type NextRequest, NextResponse } from "next/server"
import { updateWhatsAppConfig } from "@/lib/db"

export async function POST(request: NextRequest) {
  try {
    console.log(`[API UPDATE] Iniciando actualización de configuración`)

    const { id, ...updates } = await request.json()
    console.log(`[API UPDATE] ID: ${id}, Datos:`, updates)

    if (!id) {
      console.error(`[API UPDATE] ID de configuración no proporcionado`)
      return NextResponse.json({ error: "ID de configuración requerido" }, { status: 400 })
    }

    const updatedConfig = await updateWhatsAppConfig(id, updates)

    if (!updatedConfig) {
      console.error(`[API UPDATE] Configuración ${id} no encontrada`)
      return NextResponse.json({ error: "Configuración no encontrada" }, { status: 404 })
    }

    console.log(`[API UPDATE] Configuración ${id} actualizada exitosamente`)
    return NextResponse.json(updatedConfig)
  } catch (error) {
    console.error(`[API UPDATE] Error al actualizar configuración:`, error)

    const errorMessage = error instanceof Error ? error.message : "Error desconocido"

    return NextResponse.json(
      {
        error: "Error interno del servidor",
        details: errorMessage,
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    )
  }
}
