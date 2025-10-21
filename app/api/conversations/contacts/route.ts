import { NextResponse } from "next/server"
import { getConversationContacts } from "@/lib/conversations"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const configId = searchParams.get("configId")
    const dateFrom = searchParams.get("dateFrom")
    const dateTo = searchParams.get("dateTo")

    console.log("[API] GET /api/conversations/contacts - configId:", configId)
    console.log("[API] Date filters - from:", dateFrom, "to:", dateTo)

    if (!configId) {
      return NextResponse.json({ error: "configId es requerido" }, { status: 400 })
    }

    const contacts = await getConversationContacts(configId, dateFrom || undefined, dateTo || undefined)

    console.log("[API] Contacts fetched:", contacts.length)

    return NextResponse.json({ contacts })
  } catch (error) {
    console.error("[API] Error obteniendo contactos:", error)
    return NextResponse.json({ error: "Error obteniendo contactos" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"
