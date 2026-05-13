import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const clienteId = searchParams.get("cliente_id")
    const fechaInicio = searchParams.get("fecha_inicio")
    const fechaFin = searchParams.get("fecha_fin")

    if (!clienteId || !fechaInicio || !fechaFin) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 }
      )
    }

    const url = `https://proxy.santiagovulliez.com/proxy_service/wpp_consumos.php?cliente_id=${encodeURIComponent(clienteId)}&fecha_inicio=${fechaInicio}&fecha_fin=${fechaFin}`

    const response = await fetch(url)

    if (!response.ok) {
      console.error("[API] Error fetching mensajes_pagados:", response.status)
      return NextResponse.json(
        { error: "Failed to fetch data from external service" },
        { status: response.status }
      )
    }

    const data = await response.json()

    return NextResponse.json(data)
  } catch (error) {
    console.error("[API] Error in mensajes-pagados route:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
