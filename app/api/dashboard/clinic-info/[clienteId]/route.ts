import { type NextRequest, NextResponse } from "next/server"
import { getClinicInfo, saveClinicInfo } from "@/lib/db"
import { logger } from "@/lib/logger"

interface RouteParams {
  params: {
    clienteId: string
  }
}

/**
 * Info institucional guardada de una clínica (base de conocimiento para la
 * IA). Hermana de /api/dashboard/configs/[id], pero es un dominio separado
 * (ver lib/types.ts ClinicInfo) — se guarda con su propia clave por
 * cliente_id en vez de vivir dentro de WhatsAppConfig.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const info = await getClinicInfo(params.clienteId)
    return NextResponse.json({ success: true, info })
  } catch (error) {
    logger.error("API", "Error al obtener información de clínica", error)
    return NextResponse.json({ success: false, error: "Error interno del servidor" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const updates = await request.json()

    if (!params.clienteId) {
      return NextResponse.json({ success: false, error: "cliente_id requerido" }, { status: 400 })
    }

    // El guardado desde el dashboard (manual o después de revisar un import)
    // siempre queda marcado como "manual" — el estado "import" es sólo el
    // draft transitorio que vive en el job, nunca lo que queda persistido.
    const info = await saveClinicInfo(params.clienteId, { ...updates, updatedBy: "manual" })
    return NextResponse.json({ success: true, info })
  } catch (error) {
    logger.error("API", "Error al guardar información de clínica", error)
    return NextResponse.json({ success: false, error: "Error interno del servidor" }, { status: 500 })
  }
}
