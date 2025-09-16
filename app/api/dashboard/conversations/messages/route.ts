import { NextResponse } from "next/server"
import { getConversationMessages } from "@/lib/db"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const configId = searchParams.get("config_id")
    const phoneNumber = searchParams.get("phone_number")
    const limit = Number.parseInt(searchParams.get("limit") || "50")

    if (!configId || !phoneNumber) {
      return NextResponse.json(
        {
          success: false,
          error: "config_id y phone_number son requeridos",
        },
        { status: 400 },
      )
    }

    const messages = await getConversationMessages(configId, phoneNumber, limit)

    return NextResponse.json({
      success: true,
      messages,
    })
  } catch (error) {
    console.error("Error al obtener mensajes:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}

export const dynamic = "force-dynamic"
