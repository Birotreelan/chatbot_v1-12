import { type NextRequest, NextResponse } from "next/server"
import {
  getAllClientPromptConfigs,
  createClientPromptConfig,
  updateClientPromptConfig,
  deleteClientPromptConfig,
} from "@/lib/system-prompts"
import { checkAuth } from "@/lib/auth"

export async function GET() {
  try {
    const authResult = await checkAuth()
    if (!authResult.success) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const configs = await getAllClientPromptConfigs()
    return NextResponse.json({ configs })
  } catch (error) {
    console.error("[API] Error obteniendo configuraciones de prompts:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await checkAuth()
    if (!authResult.success) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const body = await request.json()
    const { clienteId, companyName, businessType, customInstructions, whatsappSpecific, widgetSpecific, active } = body

    if (!clienteId || !companyName || !businessType || !customInstructions) {
      return NextResponse.json(
        { error: "Faltan campos requeridos: clienteId, companyName, businessType, customInstructions" },
        { status: 400 },
      )
    }

    const config = await createClientPromptConfig({
      clienteId,
      companyName,
      businessType,
      customInstructions,
      whatsappSpecific,
      widgetSpecific,
      active: active !== false, // Por defecto true
    })

    return NextResponse.json({ config })
  } catch (error) {
    console.error("[API] Error creando configuración de prompt:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const authResult = await checkAuth()
    if (!authResult.success) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const body = await request.json()
    const { clienteId, ...updates } = body

    if (!clienteId) {
      return NextResponse.json({ error: "clienteId es requerido" }, { status: 400 })
    }

    const config = await updateClientPromptConfig(clienteId, updates)

    if (!config) {
      return NextResponse.json({ error: "Configuración no encontrada" }, { status: 404 })
    }

    return NextResponse.json({ config })
  } catch (error) {
    console.error("[API] Error actualizando configuración de prompt:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authResult = await checkAuth()
    if (!authResult.success) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const clienteId = searchParams.get("clienteId")

    if (!clienteId) {
      return NextResponse.json({ error: "clienteId es requerido" }, { status: 400 })
    }

    const success = await deleteClientPromptConfig(clienteId)

    if (!success) {
      return NextResponse.json({ error: "Configuración no encontrada" }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[API] Error eliminando configuración de prompt:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
