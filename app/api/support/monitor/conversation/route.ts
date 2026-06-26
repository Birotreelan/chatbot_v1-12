import { NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { getWhatsAppConfigById } from "@/lib/db"
import { getConversationMessages } from "@/lib/conversations"
import { getActiveSessionByPhone, getSupportMessages } from "@/lib/human-support"
import type { HumanSupportMessage } from "@/lib/types"
import { nanoid } from "nanoid"

export const dynamic = "force-dynamic"

// GET: conversation history for a specific contact in the monitor
// ?configId=xxx&phoneNumber=yyy&limit=100
export async function GET(request: Request) {
  try {
    const session = await getSessionFromRequest(request)
    if (!session) {
      return NextResponse.json({ success: false, error: "No autenticado" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const configId = searchParams.get("configId")
    const phoneNumber = searchParams.get("phoneNumber")
    const limit = parseInt(searchParams.get("limit") || "150", 10)

    if (!configId || !phoneNumber) {
      return NextResponse.json({ success: false, error: "Faltan parámetros" }, { status: 400 })
    }

    // Verify this config belongs to the agent's tenant
    const config = await getWhatsAppConfigById(configId)
    if (!config) {
      return NextResponse.json({ success: false, error: "Configuración no encontrada" }, { status: 404 })
    }
    if (session.tenantId && config.cliente_id !== session.tenantId) {
      return NextResponse.json({ success: false, error: "No autorizado" }, { status: 403 })
    }

    // Load conversation messages
    const { messages: convMessages } = await getConversationMessages(configId, phoneNumber, limit, 0)

    // Check for active support session
    const activeSession = await getActiveSessionByPhone(configId, phoneNumber)
    let supportMessages: HumanSupportMessage[] = []
    if (activeSession) {
      supportMessages = await getSupportMessages(activeSession.id)
    }

    // Merge and deduplicate
    const allMessages: HumanSupportMessage[] = [
      ...convMessages.map((m) => ({
        id: m.id || nanoid(),
        sessionId: activeSession?.id || "",
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.content,
        timestamp: m.timestamp,
      })),
      ...supportMessages,
    ]

    const unique = Array.from(new Map(allMessages.map((m) => [m.id, m])).values())
    unique.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    return NextResponse.json({
      success: true,
      messages: unique,
      activeSession: activeSession
        ? {
            id: activeSession.id,
            status: activeSession.status,
            assignedTo: activeSession.assignedTo,
          }
        : null,
      configName: config.displayName || config.alias || configId,
    })
  } catch (error: any) {
    console.error("[API Monitor Conversation] Error:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
