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

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth()
    const { id: sessionId } = await params

    const supportSession = await getSupportSession(sessionId)

    if (!supportSession) {
      return NextResponse.json({ success: false, error: "Sesión no encontrada" }, { status: 404 })
    }

    // Verificar permisos: super admin ve todo, agente solo su tenant
    if (session.role === "support_agent" && supportSession.tenantId !== session.tenantId) {
      return NextResponse.json({ success: false, error: "No autorizado" }, { status: 403 })
    }

    // Obtener historial completo de la conversación (incluye mensajes de IA)
    const conversationHistory = await getConversationMessages(supportSession.configId, supportSession.phoneNumber)

    // Obtener mensajes de la sesión de soporte (solo mensajes del agente)
    const supportMessages = await getSupportMessages(sessionId)

    return NextResponse.json({
      success: true,
      session: supportSession,
      conversationHistory,
      supportMessages,
    })
  } catch (error: any) {
    console.error("[API] Error obteniendo sesión:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: sessionId } = await params
    const body = await request.json()
    const { action } = body

    console.log("[v0] [API SESSION] POST recibido:", { sessionId, action })

    switch (action) {
      case "assign":
        return await handleAssign(sessionId)

      case "close":
        return await handleClose(sessionId, body.note)

      case "message":
        return await handleMessage(sessionId, body.message)

      default:
        return NextResponse.json({ success: false, error: "Acción no válida" }, { status: 400 })
    }
  } catch (error: any) {
    console.error("[API SESSION] Error:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

async function handleAssign(sessionId: string) {
  console.log("[v0] [API ASSIGN] Iniciando asignación de sesión:", sessionId)

  try {
    console.log("[v0] [API ASSIGN] Verificando autenticación...")
    const session = await requireSupportAgent()
    console.log("[v0] [API ASSIGN] Usuario autenticado:", { userId: session.userId, tenantId: session.tenantId })

    console.log("[v0] [API ASSIGN] Buscando sesión de soporte...")
    const supportSession = await getSupportSession(sessionId)
    console.log("[v0] [API ASSIGN] Sesión encontrada:", supportSession ? "SI" : "NO")

    if (!supportSession) {
      console.log("[v0] [API ASSIGN] ERROR: Sesión no encontrada")
      return NextResponse.json({ success: false, error: "Sesión no encontrada" }, { status: 404 })
    }

    console.log("[v0] [API ASSIGN] Verificando tenant match...")
    if (supportSession.tenantId !== session.tenantId) {
      console.log("[v0] [API ASSIGN] ERROR: Tenant no coincide")
      return NextResponse.json({ success: false, error: "No autorizado para esta sesión" }, { status: 403 })
    }

    console.log("[v0] [API ASSIGN] Verificando status:", supportSession.status)
    if (supportSession.status !== "pending") {
      console.log("[v0] [API ASSIGN] ERROR: Sesión no está en estado pending")
      return NextResponse.json({ success: false, error: "Sesión no disponible para asignar" }, { status: 400 })
    }

    console.log("[v0] [API ASSIGN] Asignando sesión al agente...")
    const assigned = await assignSessionToAgent(sessionId, session.userId)
    console.log("[v0] [API ASSIGN] Resultado de asignación:", assigned)

    if (!assigned) {
      console.log("[v0] [API ASSIGN] ERROR: No se pudo asignar la sesión")
      return NextResponse.json({ success: false, error: "No se pudo asignar la sesión" }, { status: 500 })
    }

    // Enviar mensaje automático al usuario
    try {
      console.log("[v0] [API ASSIGN] Enviando mensaje de confirmación...")
      const config = await getWhatsAppConfigById(supportSession.configId)
      if (config) {
        const message = `Un agente está ahora contigo y te ayudará en breve. 👋`
        await sendWhatsAppMessage(config.phoneNumberId, config.accessToken, supportSession.phoneNumber, message)
        console.log("[v0] [API ASSIGN] Mensaje enviado")
      }
    } catch (error) {
      console.error("[v0] [API ASSIGN] Error enviando mensaje:", error)
    }

    console.log("[v0] [API ASSIGN] ✅ Asignación completada")
    return NextResponse.json({
      success: true,
      message: "Sesión asignada correctamente",
    })
  } catch (error: any) {
    console.error("[v0] [API ASSIGN] ❌ ERROR:", error)
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

    // Verificar permisos
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
      console.error("[API] Error enviando mensaje de cierre:", error)
    }

    return NextResponse.json({
      success: true,
      message: "Sesión cerrada correctamente",
    })
  } catch (error: any) {
    console.error("[API] Error cerrando sesión:", error)
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
    console.error("[API] Error enviando mensaje:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
