import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const cliente_id = searchParams.get("cliente_id")

  console.log("[WIDGET-API] Solicitud recibida con parámetros:", {
    cliente_id: searchParams.get("cliente_id"),
    url: request.url,
  })

  if (!cliente_id) {
    return NextResponse.json({ error: "Missing cliente_id parameter" }, { status: 400 })
  }

  try {
    const config = await prisma.widgetConfig.findUnique({
      where: {
        clienteId: cliente_id,
      },
    })

    console.log("[WIDGET-API] Configuración encontrada:", {
      id: config?.id,
      displayName: config?.displayName,
      widgetEnabled: config?.widgetEnabled,
    })

    if (!config) {
      return NextResponse.json({ error: "Widget configuration not found" }, { status: 404 })
    }

    return NextResponse.json(config)
  } catch (error) {
    console.error("Error fetching widget configuration:", error)
    return NextResponse.json({ error: "Failed to fetch widget configuration" }, { status: 500 })
  }
}
