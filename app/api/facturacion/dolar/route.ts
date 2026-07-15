import { NextResponse } from "next/server"
import { requireBillingAgentForApi } from "@/lib/auth"
import { getDolarVenta } from "@/lib/facturacion-dolar"

export async function GET() {
  try {
    const { session, error } = await requireBillingAgentForApi()
    if (!session) {
      return NextResponse.json({ error: error || "No autorizado" }, { status: 401 })
    }

    const dolarVenta = await getDolarVenta()
    return NextResponse.json({ exito: true, dolarVenta })
  } catch (error) {
    console.error("[FACTURACION_DOLAR_API] Error:", error)
    return NextResponse.json({ error: "Error al obtener cotización del dólar" }, { status: 500 })
  }
}
