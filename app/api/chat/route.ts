import { type NextRequest, NextResponse } from "next/server"
import { processWebChatMessage } from "@/lib/web-chat-final"
import { getWhatsappConfigByClienteId } from "@/lib/db"

export async function POST(request: NextRequest) {
  console.log("[API-CHAT] 🚀 === NUEVA PETICIÓN DE CHAT ===")
  console.log("[API-CHAT] 📅 Timestamp:", new Date().toISOString())
  console.log("[API-CHAT] 🌐 URL:", request.url)
  console.log("[API-CHAT] 🌍 Origin:", request.headers.get("origin"))
  console.log("[API-CHAT] 🔗 Referer:", request.headers.get("referer"))
  console.log("[API-CHAT] 👤 User-Agent:", request.headers.get("user-agent"))
  console.log("[API-CHAT] 📋 Todos los headers:")
  request.headers.forEach((value, key) => {
    console.log(`[API-CHAT] - ${key}: ${value}`)
  })

  try {
    const body = await request.json()
    console.log("[API-CHAT] 📦 Body recibido:", JSON.stringify(body, null, 2))

    const { message, cliente_id, session_id, source, sede_id } = body

    console.log("[API-CHAT] 🔍 Parámetros validados:")
    console.log("[API-CHAT] - message:", message)
    console.log("[API-CHAT] - cliente_id:", cliente_id)
    console.log("[API-CHAT] - session_id:", session_id)
    console.log("[API-CHAT] - source:", source)
    console.log("[API-CHAT] - sede_id:", sede_id)

    // Validar parámetros requeridos
    if (!message || !cliente_id || !session_id) {
      const missingParams = {
        message: !message,
        cliente_id: !cliente_id,
        session_id: !session_id,
      }
      console.log("[API-CHAT] ❌ Parámetros faltantes:", missingParams)
      return NextResponse.json(
        {
          success: false,
          error: "Parámetros requeridos faltantes",
          missing: missingParams,
        },
        { status: 400 },
      )
    }

    console.log("[API-CHAT] ✅ Validaciones pasadas, buscando configuración...")

    // Obtener configuración del cliente
    const config = await getWhatsappConfigByClienteId(cliente_id)
    if (!config) {
      console.log("[API-CHAT] ❌ Configuración no encontrada para cliente_id:", cliente_id)
      return NextResponse.json(
        {
          success: false,
          error: "Configuración no encontrada",
        },
        { status: 404 },
      )
    }

    console.log("[API-CHAT] ✅ Configuración encontrada:")
    console.log("[API-CHAT] - ID:", config.id)
    console.log("[API-CHAT] - Display Name:", config.displayName)
    console.log("[API-CHAT] - Assistant ID:", config.assistantId)

    const effectiveSedeId = sede_id || config.sede_id
    console.log("[API-CHAT] - Sede ID efectivo:", effectiveSedeId, sede_id ? "(del request)" : "(del config)")

    // Procesar mensaje con web chat
    console.log("[API-CHAT] 🤖 Procesando mensaje con web chat...")
    const response = await processWebChatMessage({
      message,
      sessionId: session_id,
      config,
      ip: request.ip || "unknown",
      sedeId: effectiveSedeId,
    })

    console.log("[API-CHAT] ✅ Respuesta generada:")
    if (response.response) {
      console.log("[API-CHAT] - Longitud:", response.response.length, "caracteres")
      console.log("[API-CHAT] - Contenido:", response.response.substring(0, 200) + "...")
    } else {
      console.log("[API-CHAT] - Sin respuesta (error):", response.error)
    }

    if (response.error && !response.response) {
      return NextResponse.json(
        {
          success: false,
          error: response.error,
        },
        { status: 500 },
      )
    }

    const responseData = {
      success: true,
      response: response.response,
    }

    console.log("[API-CHAT] 📤 Enviando respuesta:", JSON.stringify(responseData, null, 2))

    return NextResponse.json(responseData)
  } catch (error) {
    console.error("[API-CHAT] 💥 Error procesando solicitud:")
    console.error("[API-CHAT] - Error:", error)
    console.error("[API-CHAT] - Stack:", error instanceof Error ? error.stack : "No stack")

    return NextResponse.json(
      {
        success: false,
        error: "Error interno del servidor",
        details: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}
