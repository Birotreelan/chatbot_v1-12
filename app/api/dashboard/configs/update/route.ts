import { NextResponse } from "next/server"
import { updateWhatsAppConfig } from "@/lib/db"

export async function POST(request: Request) {
  try {
    const data = await request.json()
    console.log("[API UPDATE] Iniciando actualización de configuración")
    console.log("[API UPDATE] ID:", data.id, "Datos:", data)

    if (!data.id) {
      console.error("[API UPDATE] ID de configuración no proporcionado")
      return NextResponse.json({ error: "ID de configuración no proporcionado" }, { status: 400 })
    }

    // Extraer el ID y pasar el resto como actualizaciones
    const { id, ...updates } = data
    const config = await updateWhatsAppConfig(id, updates)

    if (!config) {
      console.error("[API UPDATE] Configuración no encontrada:", id)
      return NextResponse.json({ error: "Configuración no encontrada" }, { status: 404 })
    }

    console.log("[API UPDATE] Configuración actualizada exitosamente:", id)
    return NextResponse.json(config)
  } catch (error) {
    console.error("[API UPDATE] Error al actualizar configuración:", error)
    return NextResponse.json(
      {
        error: "Error al actualizar la configuración",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
