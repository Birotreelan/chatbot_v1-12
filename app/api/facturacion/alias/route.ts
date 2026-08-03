import { NextResponse } from "next/server"
import { requireBillingAgentForApi } from "@/lib/auth"
import { getAllAliases, setAlias } from "@/lib/facturacion-alias"

export async function GET() {
  try {
    const { session, error } = await requireBillingAgentForApi()
    if (!session) {
      return NextResponse.json({ error: error || "No autorizado" }, { status: 401 })
    }

    const alias = await getAllAliases()
    return NextResponse.json({ exito: true, alias })
  } catch (error) {
    console.error("[FACTURACION_ALIAS_API] Error:", error)
    return NextResponse.json({ error: "Error al obtener alias" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const { session, error } = await requireBillingAgentForApi()
    if (!session) {
      return NextResponse.json({ error: error || "No autorizado" }, { status: 401 })
    }

    const body = await request.json()
    const { clienteId, alias } = body

    if (!clienteId || typeof clienteId !== "string") {
      return NextResponse.json({ error: "clienteId es obligatorio" }, { status: 400 })
    }
    if (typeof alias !== "string") {
      return NextResponse.json({ error: "alias debe ser un string" }, { status: 400 })
    }

    await setAlias(clienteId, alias)
    return NextResponse.json({ exito: true, clienteId, alias: alias.trim() })
  } catch (error) {
    console.error("[FACTURACION_ALIAS_API] Error guardando alias:", error)
    return NextResponse.json({ error: "Error al guardar el alias" }, { status: 500 })
  }
}
