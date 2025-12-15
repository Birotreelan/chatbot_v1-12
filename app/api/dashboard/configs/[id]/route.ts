import { type NextRequest, NextResponse } from "next/server"
import { getWhatsAppConfig, updateWhatsAppConfig, deleteWhatsAppConfig } from "@/lib/db"
import { logger } from "@/lib/logger"

interface RouteParams {
  params: {
    id: string
  }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    logger.apiStart(`/configs/${params.id}`, "GET")

    const config = await getWhatsAppConfig(params.id)

    if (!config) {
      logger.warn("API", `Config no encontrada: ${params.id}`)
      return NextResponse.json({ error: "Configuración no encontrada" }, { status: 404 })
    }

    logger.apiSuccess(`/configs/${params.id}`, "GET")
    return NextResponse.json(config)
  } catch (error) {
    logger.apiError(`/configs/${params.id}`, "GET", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    logger.apiStart(`/configs/${params.id}`, "PUT")

    const updates = await request.json()

    if (!params.id) {
      logger.error("API", "ID no proporcionado")
      return NextResponse.json({ error: "ID de configuración requerido" }, { status: 400 })
    }

    const updatedConfig = await updateWhatsAppConfig(params.id, updates)

    if (!updatedConfig) {
      logger.warn("API", `Config no encontrada: ${params.id}`)
      return NextResponse.json({ error: "Configuración no encontrada" }, { status: 404 })
    }

    logger.apiSuccess(`/configs/${params.id}`, "PUT")
    return NextResponse.json(updatedConfig)
  } catch (error) {
    logger.apiError(`/configs/${params.id}`, "PUT", error)

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

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    logger.apiStart(`/configs/${params.id}`, "DELETE")

    const success = await deleteWhatsAppConfig(params.id)

    if (!success) {
      logger.warn("API", `Config no encontrada: ${params.id}`)
      return NextResponse.json({ error: "Configuración no encontrada" }, { status: 404 })
    }

    logger.apiSuccess(`/configs/${params.id}`, "DELETE")
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.apiError(`/configs/${params.id}`, "DELETE", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
