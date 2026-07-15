import { NextResponse } from "next/server"
import { requireBillingAgentForApi } from "@/lib/auth"
import { CLIENTES_EXCLUIDOS_FACTURACION } from "@/lib/facturacion-sedes"
import { getDolarVenta } from "@/lib/facturacion-dolar"

interface FacturacionClienteRow {
  clienteId: string
  clienteIdBase: string
  nombreCliente: string
  totalInteracciones: number
}

interface ClienteSinIAExterno {
  cliente: string
  cliente_id: string
  mensajes_pagados: number
}

interface ConsumosSinIAResponse {
  fecha_inicio: string
  fecha_fin: string
  total: number
  clientes: ClienteSinIAExterno[]
}

export async function GET(request: Request) {
  try {
    const { session, error } = await requireBillingAgentForApi()
    if (!session) {
      return NextResponse.json({ error: error || "No autorizado" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const fechaInicio = searchParams.get("fechaInicio")
    const fechaFin = searchParams.get("fechaFin")

    if (!fechaInicio || !fechaFin) {
      return NextResponse.json(
        { error: "Los parámetros fechaInicio y fechaFin son obligatorios." },
        { status: 400 },
      )
    }

    let filas: FacturacionClienteRow[] = []
    try {
      const externalResponse = await fetch(
        `https://proxy.santiagovulliez.com/proxy_service/wpp_consumos_sin_ia.php?fecha_inicio=${fechaInicio}&fecha_fin=${fechaFin}`,
      )
      if (externalResponse.ok) {
        const data: ConsumosSinIAResponse = await externalResponse.json()
        filas = (data.clientes || [])
          .filter((c) => !CLIENTES_EXCLUIDOS_FACTURACION.includes(c.cliente_id))
          .map((c) => ({
            clienteId: c.cliente_id,
            clienteIdBase: c.cliente_id,
            nombreCliente: c.cliente,
            totalInteracciones: c.mensajes_pagados,
          }))
      } else {
        console.warn(`[FACTURACION_SIN_IA_API] Error ${externalResponse.status} consultando servicio externo`)
      }
    } catch (err) {
      console.warn("[FACTURACION_SIN_IA_API] Error consultando servicio externo:", err)
    }

    filas.sort((a, b) => a.nombreCliente.localeCompare(b.nombreCliente))

    const dolarVenta = await getDolarVenta()

    return NextResponse.json({
      exito: true,
      filtroFechas: { fechaInicio, fechaFin },
      dolarVenta,
      clientes: filas,
    })
  } catch (error) {
    console.error("[FACTURACION_SIN_IA_API] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error al obtener datos de facturación sin IA" },
      { status: 500 },
    )
  }
}
