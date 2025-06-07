import { NextResponse } from "next/server"
import { getAllWhatsAppConfigs } from "@/lib/db"

export async function GET() {
  try {
    const configs = await getAllWhatsAppConfigs()
    return NextResponse.json(configs)
  } catch (error) {
    console.error("Error al obtener configuraciones:", error)
    return NextResponse.json([], { status: 500 })
  }
}
