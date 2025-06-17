import { NextResponse } from "next/server"

export async function POST(request: Request) {
  console.log("[API-CHAT] 🚀 === NUEVA PETICIÓN DE CHAT ===")
  console.log("[API-CHAT] 📅 Timestamp:", new Date().toISOString())
  console.log("[API-CHAT] 🌐 URL:", request.url)
  console.log("[API-CHAT] 📋 Headers:", Object.fromEntries(request.headers.entries()))

  try {
    const body = await request.json()
    console.log("[API-CHAT] 📦 Body completo recibido:", JSON.stringify(body, null, 2))

    const { message, cliente_id, session_id, source } = body

    console.log("[API-CHAT] 🔍 Parámetros extraídos:")
    console.log("[API-CHAT] - message:", message)
    console.log("[API-CHAT] - cliente_id:", cliente_id)
    console.log("[API-CHAT] - session_id:", session_id)
    console.log("[API-CHAT] - source:", source)

    // Validaciones
    if (!message || typeof message !== "string") {
      console.log("[API-CHAT] ❌ Error: Mensaje inválido")
      return NextResponse.json(
        {
          success: false,
          error: "Mensaje requerido",
        },
        { status: 400 },
      )
    }

    if (!cliente_id) {
      console.log("[API-CHAT] ❌ Error: cliente_id requerido")
      return NextResponse.json(
        {
          success: false,
          error: "cliente_id requerido",
        },
        { status: 400 },
      )
    }

    console.log("[API-CHAT] ✅ Validaciones pasadas, buscando configuración...")

    // Continuar con el resto del código existente...
    return NextResponse.json({ message: "OK" })
  } catch (error: any) {
    console.error("[API-CHAT] 💥 Error en la función POST:", error)
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Error desconocido",
      },
      { status: 500 },
    )
  }
}
