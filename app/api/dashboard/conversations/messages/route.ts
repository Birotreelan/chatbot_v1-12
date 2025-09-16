import { type NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { getConversationMessages } from "@/lib/db"

export async function GET(request: NextRequest) {
  try {
    console.log("[API] Obteniendo mensajes de conversación...")

    // Verificar autenticación
    const session = await getSession()
    if (!session) {
      console.log("[API] Usuario no autenticado")
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    // Obtener parámetros de la URL
    const { searchParams } = new URL(request.url)
    const configId = searchParams.get("configId")
    const phoneNumber = searchParams.get("phoneNumber")

    if (!configId || !phoneNumber) {
      return NextResponse.json({ error: "configId y phoneNumber son requeridos" }, { status: 400 })
    }

    console.log(`[API] Obteniendo mensajes para config ${configId} y teléfono ${phoneNumber}`)

    // Obtener mensajes de la conversación
    const messages = await getConversationMessages(configId, phoneNumber)

    console.log(`[API] Encontrados ${messages.length} mensajes`)

    return NextResponse.json({
      success: true,
      messages,
    })
  } catch (error) {
    console.error("[API] Error obteniendo mensajes:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}
