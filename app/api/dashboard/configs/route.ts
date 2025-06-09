import { NextResponse } from "next/server"
import { getAllWhatsAppConfigs, createWhatsAppConfig } from "@/lib/db"

export async function GET() {
  try {
    const configs = await getAllWhatsAppConfigs()
    return NextResponse.json(configs)
  } catch (error) {
    console.error("Error al obtener configuraciones:", error)
    return NextResponse.json([], { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const data = await request.json()
    console.log("[API CREATE] Iniciando creación de configuración", data)

    // Validar datos mínimos requeridos
    if (!data.displayName) {
      return NextResponse.json(
        { error: "Faltan datos requeridos", details: "El nombre de la configuración es obligatorio" },
        { status: 400 },
      )
    }

    const config = await createWhatsAppConfig(data)
    console.log("[API CREATE] Configuración creada con ID:", config.id)

    return NextResponse.json(config)
  } catch (error) {
    console.error("Error al crear configuración:", error)
    return NextResponse.json(
      { error: "Error al crear la configuración", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
