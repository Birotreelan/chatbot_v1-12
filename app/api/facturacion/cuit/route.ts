import { NextResponse } from "next/server"
import { requireBillingAgentForApi } from "@/lib/auth"
import { getAllCuits, setCuit } from "@/lib/facturacion-cuit"

export async function GET() {
  try {
    const { session, error } = await requireBillingAgentForApi()
    if (!session) {
      return NextResponse.json({ error: error || "No autorizado" }, { status: 401 })
    }

    const cuit = await getAllCuits()
    return NextResponse.json({ exito: true, cuit })
  } catch (error) {
    console.error("[FACTURACION_CUIT_API] Error:", error)
    return NextResponse.json({ error: "Error al obtener CUIT" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const { session, error } = await requireBillingAgentForApi()
    if (!session) {
      return NextResponse.json({ error: error || "No autorizado" }, { status: 401 })
    }

    const body = await request.json()
    const { clienteId, cuit } = body

    if (!clienteId || typeof clienteId !== "string") {
      return NextResponse.json({ error: "clienteId es obligatorio" }, { status: 400 })
    }
    if (typeof cuit !== "string") {
      return NextResponse.json({ error: "cuit debe ser un string" }, { status: 400 })
    }

    await setCuit(clienteId, cuit)
    return NextResponse.json({ exito: true, clienteId, cuit: cuit.trim() })
  } catch (error) {
    console.error("[FACTURACION_CUIT_API] Error guardando CUIT:", error)
    return NextResponse.json({ error: "Error al guardar el CUIT" }, { status: 500 })
  }
}
