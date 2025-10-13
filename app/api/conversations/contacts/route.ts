import { NextResponse } from "next/server"
import { getConversationContacts } from "@/lib/conversations"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const configId = searchParams.get("configId")

    console.log("[API] GET /api/conversations/contacts - configId:", configId)

    if (!configId) {
      return NextResponse.json({ error: "configId es requerido" }, { status: 400 })
    }

    const contacts = await getConversationContacts(configId)

    console.log("[API] Contacts fetched:", contacts.length)
    if (contacts.length > 0) {
      console.log("[API] First contact full data:", JSON.stringify(contacts[0], null, 2))
      console.log(
        "[API] All contact phone numbers:",
        contacts.map((c) => c.phoneNumber),
      )
    }

    return NextResponse.json({ contacts })
  } catch (error) {
    console.error("[API] Error obteniendo contactos:", error)
    return NextResponse.json({ error: "Error obteniendo contactos" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"
