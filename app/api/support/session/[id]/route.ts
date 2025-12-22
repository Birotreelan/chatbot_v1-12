import { NextResponse } from "next/server"
import { requireAuth, requireSupportAgent } from "@/lib/auth"
import {
  getSupportSession,
  getSupportMessages,
  assignSessionToAgent,
  closeSession,
  saveSupportMessage,
} from "@/lib/human-support"
import { getConversationMessages } from "@/lib/conversations"
import { getWhatsAppConfigById } from "@/lib/db"
import { sendWhatsAppMessage } from "@/lib/whatsapp-api"
import { nanoid } from "nanoid"
import type { HumanSupportMessage } from "@/lib/types"

type RouteContext = {
  params: Promise<{ id: string }>
}

// GET: Obtener detalle de sesión
export async function GET(request: Request, context: RouteContext) {
  try {
    console.log("[v0] [API SESSION GET] Iniciando")
    const session = await requireAuth()
    const { id: sessionId } = await context.params

    const supportSession = await getSupportSession(sessionId)

    if (!supportSession) {
      return NextResponse.json({ success: false, error: "Sesión no encontrada" }, { status: 404 })
    }

    // Verificar permisos
    if (session.role === "support_agent" && supportSession.tenantId !== session.tenantId) {
      return NextResponse.json({ success: false, error: "No autorizado" }, { status: 403 })
    }

    const conversationHistory = await getConversationMessages(supportSession.configId, supportSession.phoneNumber)
    const supportMessages = await getSupportMessages(sessionId)

    return NextResponse.json({
      success: true,
      session: supportSession,
      conversationHistory,
      supportMessages,
    })
  } catch (error: any) {
    console.error("[API SESSION GET] Error:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

// POST: Acciones sobre la sesión (assign, message, close)
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: sessionId } = await context.params
    console.log("[v0] [API SESSION POST] Session ID recibido:", sessionId)

    const body = await request.json()
    const { action } = body

    console.log("[v0] [API SESSION POST] Recibido:", { sessionId, action, body })

    if (!action) {
      console.log("[v0] [API SESSION POST] ERROR: Falta action")
      return NextResponse.json({ success: false, error: "Falta parámetro 'action'" }, { status: 400 })
    }

    switch (action) {
      case "assign":
        console.log("[v0] [API SESSION POST] Ejecutando assign")
        return await handleAssign(sessionId)

      case "close":
        console.log("[v0] [API SESSION POST] Ejecutando close")
        return await handleClose(sessionId, body.note)

      case "message":
        console.log("[v0] [API SESSION POST] Ejecutando message")
        return await handleMessage(sessionId, body.message)

      default:
        console.log("[v0] [API SESSION POST] ERROR: Acción no válida:", action)
        return NextResponse.json({ success: false, error: `Acción no válida: ${action}` }, { status: 400 })
    }
  } catch (error: any) {
    console.error("[v0] [API SESSION POST] Error general:", error)
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 },
    )
  }
}

async function handleAssign(sessionId: string) {
  console.log("[v0] [ASSIGN] Iniciando:", sessionId)

  try {
    const session = await requireSupportAgent()
    console.log("[v0] [ASSIGN] Usuario:", { userId: session.userId, tenantId: session.tenantId })

    const supportSession = await getSupportSession(sessionId)
    if (!supportSession) {
      console.log("[v0] [ASSIGN] Sesión no encontrada")
      return NextResponse.json({ success: false, error: "Sesión no encontrada" }, { status: 404 })
    }

    if (supportSession.tenantId !== session.tenantId) {
      console.log("[v0] [ASSIGN] Tenant no coincide")
      return NextResponse.json({ success: false, error: "No autorizado para esta sesión" }, { status: 403 })
    }

    if (supportSession.status !== "pending") {
      console.log("[v0] [ASSIGN] Status no es pending:", supportSession.status)
      return NextResponse.json({ success: false, error: "Sesión no disponible para asignar" }, { status: 400 })
    }

    console.log("[v0] [ASSIGN] Asignando al agente...")
    const assigned = await assignSessionToAgent(sessionId, session.userId)

    if (!assigned) {
      console.log("[v0] [ASSIGN] No se pudo asignar")
      return NextResponse.json({ success: false, error: "No se pudo asignar la sesión" }, { status: 500 })
    }

    // Enviar mensaje automático
    try {
      const config = await getWhatsAppConfigById(supportSession.configId)
      if (config) {
        const message = `Un agente está ahora contigo y te ayudará en breve. 👋`
        await sendWhatsAppMessage(config.phoneNumberId, config.accessToken, supportSession.phoneNumber, message)
        console.log("[v0] [ASSIGN] Mensaje enviado")
      }
    } catch (error) {
      console.error("[v0] [ASSIGN] Error enviando mensaje:", error)
    }

    console.log("[v0] [ASSIGN] Completado exitosamente")
    return NextResponse.json({
      success: true,
      message: "Sesión asignada correctamente",
    })
  } catch (error: any) {
    console.error("[v0] [ASSIGN] Error:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

async function handleClose(sessionId: string, note?: string) {
  try {
    const session = await requireAuth()
    const supportSession = await getSupportSession(sessionId)

    if (!supportSession) {
      return NextResponse.json({ success: false, error: "Sesión no encontrada" }, { status: 404 })
    }

    if (session.role === "support_agent" && supportSession.assignedTo !== session.userId) {
      return NextResponse.json({ success: false, error: "No estás asignado a esta sesión" }, { status: 403 })
    }

    const closed = await closeSession(sessionId, note)

    if (!closed) {
      return NextResponse.json({ success: false, error: "No se pudo cerrar la sesión" }, { status: 500 })
    }

    // Enviar mensaje automático
    try {
      const config = await getWhatsAppConfigById(supportSession.configId)
      if (config) {
        const message = `Has sido reconectado con el asistente virtual. ¡Gracias por tu paciencia! 🤖`
        await sendWhatsAppMessage(config.phoneNumberId, config.accessToken, supportSession.phoneNumber, message)
      }
    } catch (error) {
      console.error("[CLOSE] Error enviando mensaje:", error)
    }

    return NextResponse.json({
      success: true,
      message: "Sesión cerrada correctamente",
    })
  } catch (error: any) {
    console.error("[CLOSE] Error:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

async function handleMessage(sessionId: string, message: string) {
  try {
    const session = await requireSupportAgent()

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return NextResponse.json({ success: false, error: "Mensaje inválido" }, { status: 400 })
    }

    const supportSession = await getSupportSession(sessionId)

    if (!supportSession) {
      return NextResponse.json({ success: false, error: "Sesión no encontrada" }, { status: 404 })
    }

    if (supportSession.assignedTo !== session.userId) {
      return NextResponse.json({ success: false, error: "No estás asignado a esta sesión" }, { status: 403 })
    }

    if (supportSession.status !== "in_progress") {
      return NextResponse.json({ success: false, error: "Sesión no está activa" }, { status: 400 })
    }

    const config = await getWhatsAppConfigById(supportSession.configId)
    if (!config) {
      return NextResponse.json({ success: false, error: "Configuración no encontrada" }, { status: 404 })
    }

    await sendWhatsAppMessage(config.phoneNumberId, config.accessToken, supportSession.phoneNumber, message.trim())

    const supportMessage: HumanSupportMessage = {
      id: nanoid(),
      sessionId,
      role: "agent",
      content: message.trim(),
      timestamp: new Date().toISOString(),
      agentId: session.userId,
    }

    await saveSupportMessage(supportMessage)

    return NextResponse.json({
      success: true,
      message: "Mensaje enviado correctamente",
    })
  } catch (error: any) {
    console.error("[MESSAGE] Error:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
