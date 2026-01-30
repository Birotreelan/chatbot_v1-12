import { type NextRequest, NextResponse } from "next/server"
import {
  getGlobalTemplate,
  updateGlobalTemplate,
  deleteGlobalTemplate,
} from "@/lib/db"

// GET - Obtener una plantilla global por ID
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    console.log(`[GLOBAL-TEMPLATES] Obteniendo plantilla global: ${id}`)
    
    const template = await getGlobalTemplate(id)
    
    if (!template) {
      return NextResponse.json(
        { error: "Plantilla global no encontrada" },
        { status: 404 },
      )
    }
    
    return NextResponse.json({
      success: true,
      template,
    })
  } catch (error) {
    console.error("[GLOBAL-TEMPLATES] Error:", error)
    return NextResponse.json(
      {
        error: "Error al obtener plantilla global",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}

// PATCH - Actualizar una plantilla global
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()

    console.log(`[GLOBAL-TEMPLATES] Actualizando plantilla global: ${id}`)
    
    const template = await updateGlobalTemplate(id, body)
    
    if (!template) {
      return NextResponse.json(
        { error: "Plantilla global no encontrada" },
        { status: 404 },
      )
    }
    
    console.log(`[GLOBAL-TEMPLATES] Plantilla global actualizada: ${id}`)
    
    return NextResponse.json({
      success: true,
      template,
      message: "Plantilla global actualizada exitosamente",
    })
  } catch (error) {
    console.error("[GLOBAL-TEMPLATES] Error:", error)
    return NextResponse.json(
      {
        error: "Error al actualizar plantilla global",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}

// DELETE - Eliminar una plantilla global
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    console.log(`[GLOBAL-TEMPLATES] Eliminando plantilla global: ${id}`)
    
    const deleted = await deleteGlobalTemplate(id)
    
    if (!deleted) {
      return NextResponse.json(
        { error: "No se pudo eliminar la plantilla global" },
        { status: 500 },
      )
    }
    
    console.log(`[GLOBAL-TEMPLATES] Plantilla global eliminada: ${id}`)
    
    return NextResponse.json({
      success: true,
      message: "Plantilla global eliminada exitosamente",
    })
  } catch (error) {
    console.error("[GLOBAL-TEMPLATES] Error:", error)
    return NextResponse.json(
      {
        error: "Error al eliminar plantilla global",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
