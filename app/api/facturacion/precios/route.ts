import { NextResponse } from "next/server"
import { requireBillingAgentForApi } from "@/lib/auth"
import { getAllPreciosUnidad, setPrecioUnidad } from "@/lib/facturacion-precios"

export async function GET() {
  try {
    const { session, error } = await requireBillingAgentForApi()
    if (!session) {
      return NextResponse.json({ error: error || "No autorizado" }, { status: 401 })
    }

    const precios = await getAllPreciosUnidad()
    return NextResponse.json({ exito: true, precios })
  } catch (error) {
    console.error("[FACTURACION_PRECIOS_API] Error:", error)
    return NextResponse.json({ error: "Error al obtener precios" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const { session, error } = await requireBillingAgentForApi()
    if (!session) {
      return NextResponse.json({ error: error || "No autorizado" }, { status: 401 })
    }

    const body = await request.json()
    const { clienteId, valor } = body

    if (!clienteId || typeof clienteId !== "string") {
      return NextResponse.json({ error: "clienteId es obligatorio" }, { status: 400 })
    }
    const valorNum = Number(valor)
    if (!Number.isFinite(valorNum) || valorNum < 0) {
      return NextResponse.json({ error: "valor debe ser un número válido" }, { status: 400 })
    }

    await setPrecioUnidad(clienteId, valorNum)
    return NextResponse.json({ exito: true, clienteId, valor: valorNum })
  } catch (error) {
    console.error("[FACTURACION_PRECIOS_API] Error guardando precio:", error)
    return NextResponse.json({ error: "Error al guardar el precio" }, { status: 500 })
  }
}
