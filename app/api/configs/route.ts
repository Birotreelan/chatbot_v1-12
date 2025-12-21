import { NextResponse } from "next/server"
import { getAllWhatsAppConfigs } from "@/lib/db"
import { requireSuperAdmin } from "@/lib/auth"

export async function GET() {
  try {
    // Verificar autenticación de super admin
    await requireSuperAdmin()

    // Obtener todas las configuraciones
    const configs = await getAllWhatsAppConfigs()

    return NextResponse.json(configs)
  } catch (error) {
    console.error("[API] Error obteniendo configuraciones:", error)
    return NextResponse.json({ error: "Error al obtener configuraciones" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"
