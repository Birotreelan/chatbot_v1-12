import { NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import type { SessionData } from "@/lib/types"
import {
  getSupportSession,
  getSupportMessages,
  assignSessionToAgent,
  closeSession,
  saveSupportMessage,
} from "@/lib/human-support"
import { getConversationMessages, getAllConversationMessages } from "@/lib/conversations"
import { getWhatsAppConfigById } from "@/lib/db"
import { sendWhatsAppMessage } from "@/lib/whatsapp-api"
import { nanoid } from "nanoid"
import type { HumanSupportMessage } from "@/lib/types"

// GET: Obtener detalle de sesión
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    console.log("[v0] [API SESSION GET] Iniciando")
    const session = await getSessionFromRequest(request)
    if (!session) {
      return NextResponse.json({ success: false, error: "No autenticado" }, { status: 401 })
    }
    
    const { id: sessionId } = await params

    const supportSession = await getSupportSession(sessionId)

    if (!supportSession) {
      return NextResponse.json({ success: false, error: "Sesión no encontrada" }, { status: 404 })
    }

    // Verificar permisos
    if (session.role === "support_agent" && supportSession.tenantId !== session.tenantId) {
      return NextResponse.json({ success: false, error: "No autorizado" }, { status: 403 })
    }

    // Obtener historial con paginacion (ultimos 100 mensajes para soporte)
    const { messages: conversationHistory } = await getConversationMessages(supportSession.configId, supportSession.phoneNumber, 100, 0)
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
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: sessionId } = await params
    console.log("[v0] [API SESSION POST] Iniciando para sessionId:", sessionId)
    console.log("[v0] [API SESSION POST] URL:", request.url)
    console.log("[v0] [API SESSION POST] Método:", request.method)

    // Obtener sesión ANTES de consumir el body (para Safari support)
    const userSession = await getSessionFromRequest(request)
    if (!userSession) {
      return NextResponse.json({ success: false, error: "No autenticado" }, { status: 401 })
    }

    const body = await request.json()
    const { action } = body

    console.log("[v0] [API SESSION POST] Body recibido:", { sessionId, action, body })

    if (!action) {
      console.log("[v0] [API SESSION POST] ERROR: Falta action")
      return NextResponse.json({ success: false, error: "Falta parámetro 'action'" }, { status: 400 })
    }

    switch (action) {
      case "assign":
        console.log("[v0] [API SESSION POST] Ejecutando assign para:", sessionId)
        return await handleAssign(sessionId, userSession)

      case "close":
        console.log("[v0] [API SESSION POST] Ejecutando close")
        return await handleClose(sessionId, userSession, body.note)

      case "message":
        console.log("[v0] [API SESSION POST] Ejecutando message")
        return await handleMessage(sessionId, userSession, body.message)

      default:
        console.log("[v0] [API SESSION POST] ERROR: Acción no válida:", action)
        return NextResponse.json({ success: false, error: `Acción no válida: ${action}` }, { status: 400 })
    }
  } catch (error: any) {
    console.error("[v0] [API SESSION POST] Error general:", error)
    console.error("[v0] [API SESSION POST] Stack:", error.stack)
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

async function handleAssign(sessionId: string, session: SessionData) {
  console.log("[v0] [ASSIGN] Iniciando para sessionId:", sessionId)

  try {
    // Verificar que es un agente de soporte
    if (session.role !== "support_agent") {
      return NextResponse.json({ success: false, error: "Se requiere rol de agente de soporte" }, { status: 403 })
    }
    
    console.log("[v0] [ASSIGN] Usuario autenticado:", { userId: session.userId, tenantId: session.tenantId })

    const supportSession = await getSupportSession(sessionId)
    console.log("[v0] [ASSIGN] Sesión encontrada:", supportSession ? "SÍ" : "NO")

    if (!supportSession) {
      console.log("[v0] [ASSIGN] ERROR: Sesión no encontrada")
      return NextResponse.json({ success: false, error: "Sesión no encontrada" }, { status: 404 })
    }

    console.log("[v0] [ASSIGN] Estado de sesión:", supportSession.status)
    console.log("[v0] [ASSIGN] TenantId sesión:", supportSession.tenantId, "vs usuario:", session.tenantId)

    if (supportSession.tenantId !== session.tenantId) {
      console.log("[v0] [ASSIGN] ERROR: Tenant no coincide")
      return NextResponse.json({ success: false, error: "No autorizado para esta sesión" }, { status: 403 })
    }

    if (supportSession.status !== "pending") {
      console.log("[v0] [ASSIGN] ERROR: Status no es pending:", supportSession.status)
      return NextResponse.json({ success: false, error: "Sesión no disponible para asignar" }, { status: 400 })
    }

    console.log("[v0] [ASSIGN] Llamando a assignSessionToAgent...")
    const assigned = await assignSessionToAgent(sessionId, session.userId)
    console.log("[v0] [ASSIGN] Resultado de asignación:", assigned)

    if (!assigned) {
      console.log("[v0] [ASSIGN] ERROR: No se pudo asignar")
      return NextResponse.json({ success: false, error: "No se pudo asignar la sesión" }, { status: 500 })
    }

    // Enviar mensaje automático
    try {
      console.log("[v0] [ASSIGN] Obteniendo config:", supportSession.configId)
      const config = await getWhatsAppConfigById(supportSession.configId)
      if (config) {
        const message = `Un agente está ahora contigo y te ayudará en breve. 👋`
        await sendWhatsAppMessage(config.phoneNumberId, config.accessToken, supportSession.phoneNumber, message)
        console.log("[v0] [ASSIGN] Mensaje enviado exitosamente")
      } else {
        console.log("[v0] [ASSIGN] Config no encontrado")
      }
    } catch (error) {
      console.error("[v0] [ASSIGN] Error enviando mensaje:", error)
    }

    console.log("[v0] [ASSIGN] ✅ Completado exitosamente")
    return NextResponse.json({
      success: true,
      message: "Sesión asignada correctamente",
    })
  } catch (error: any) {
    console.error("[v0] [ASSIGN] ❌ Error:", error)
    console.error("[v0] [ASSIGN] Stack:", error.stack)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

async function handleClose(sessionId: string, session: SessionData, note?: string) {
  try {
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

async function handleMessage(sessionId: string, session: SessionData, message: string) {
  try {
    // Verificar que es un agente de soporte
    if (session.role !== "support_agent") {
      return NextResponse.json({ success: false, error: "Se requiere rol de agente de soporte" }, { status: 403 })
    }

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
