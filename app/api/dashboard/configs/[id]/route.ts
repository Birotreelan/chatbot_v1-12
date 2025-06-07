import { type NextRequest, NextResponse } from "next/server"
import { getWhatsAppConfig, updateWhatsAppConfig, deleteWhatsAppConfig } from "@/lib/db"

interface RouteParams {
  params: {
    id: string
  }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    console.log(`[API GET] Obteniendo configuración ${params.id}`)

    const config = await getWhatsAppConfig(params.id)

    if (!config) {
      console.log(`[API GET] Configuración ${params.id} no encontrada`)
      return NextResponse.json({ error: "Configuración no encontrada" }, { status: 404 })
    }

    console.log(`[API GET] Configuración ${params.id} obtenida exitosamente`)
    return NextResponse.json(config)
  } catch (error) {
    console.error(`[API GET] Error al obtener configuración ${params.id}:`, error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    console.log(`[API PUT] Iniciando actualización de configuración ${params.id}`)

    const updates = await request.json()
    console.log(`[API PUT] Datos recibidos para ${params.id}:`, updates)

    // Validar que el ID existe
    if (!params.id) {
      console.error(`[API PUT] ID de configuración no proporcionado`)
      return NextResponse.json({ error: "ID de configuración requerido" }, { status: 400 })
    }

    const updatedConfig = await updateWhatsAppConfig(params.id, updates)

    if (!updatedConfig) {
      console.error(`[API PUT] Configuración ${params.id} no encontrada`)
      return NextResponse.json({ error: "Configuración no encontrada" }, { status: 404 })
    }

    console.log(`[API PUT] Configuración ${params.id} actualizada exitosamente`)
    return NextResponse.json(updatedConfig)
  } catch (error) {
    console.error(`[API PUT] Error al actualizar configuración ${params.id}:`, error)

    // Proporcionar más detalles del error
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
    console.log(`[API DELETE] Eliminando configuración ${params.id}`)

    const success = await deleteWhatsAppConfig(params.id)

    if (!success) {
      console.log(`[API DELETE] Configuración ${params.id} no encontrada`)
      return NextResponse.json({ error: "Configuración no encontrada" }, { status: 404 })
    }

    console.log(`[API DELETE] Configuración ${params.id} eliminada exitosamente`)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error(`[API DELETE] Error al eliminar configuración ${params.id}:`, error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
