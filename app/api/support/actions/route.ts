import { NextResponse } from "next/server"
import { requireAuthFromRequest, requireSupportAgentFromRequest, getSessionFromRequest } from "@/lib/auth"
import type { SessionData } from "@/lib/types"
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

// GET: Obtener detalle de sesión
export async function GET(request: Request) {
  try {
    console.log("[v0] [API SUPPORT ACTIONS GET] Iniciando")
    const { session, error } = await requireAuthFromRequest(request)
    
    if (!session) {
      return NextResponse.json({ success: false, error: error || "No autenticado" }, { status: 401 })
    }
    
    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get("sessionId")

    if (!sessionId) {
      return NextResponse.json({ success: false, error: "Falta parámetro 'sessionId'" }, { status: 400 })
    }

    console.log("[v0] [API SUPPORT ACTIONS GET] sessionId:", sessionId)

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

    const allMessages: HumanSupportMessage[] = [
      // Mensajes de la conversación (usuario y asistente)
      ...conversationHistory.map((msg: any) => ({
        id: msg.id,
        sessionId,
        role: msg.role === "user" ? ("user" as const) : ("assistant" as const),
        content: msg.content,
        timestamp: msg.timestamp,
      })),
      // Mensajes de soporte humano (agente únicamente)
      ...supportMessages,
    ]

    const uniqueMessages = Array.from(new Map(allMessages.map((msg) => [msg.id, msg])).values())

    // Ordenar por timestamp
    uniqueMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    console.log("[v0] [API SUPPORT ACTIONS GET] Total de mensajes antes de deduplicar:", allMessages.length)
    console.log("[v0] [API SUPPORT ACTIONS GET] Total de mensajes únicos:", uniqueMessages.length)
    console.log(
      "[v0] [API SUPPORT ACTIONS GET] Roles en mensajes:",
      uniqueMessages.map((m) => ({ role: m.role, content: m.content.substring(0, 30) })),
    )

    return NextResponse.json({
      success: true,
      session: {
        ...supportSession,
        messages: uniqueMessages,
      },
    })
  } catch (error: any) {
    console.error("[API SUPPORT ACTIONS GET] Error:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

// POST: Acciones sobre sesiones de soporte
export async function POST(request: Request) {
  try {
    console.log("[v0] [API SUPPORT ACTIONS] Iniciando")

    // Obtener sesión ANTES de consumir el body (para Safari support)
    const userSession = await getSessionFromRequest(request)
    if (!userSession) {
      return NextResponse.json({ success: false, error: "No autenticado" }, { status: 401 })
    }

    const body = await request.json()
    const { action, sessionId, message, note } = body

    console.log("[v0] [API SUPPORT ACTIONS] Datos recibidos:", { action, sessionId })

    if (!action) {
      return NextResponse.json({ success: false, error: "Falta parámetro 'action'" }, { status: 400 })
    }

    if (!sessionId) {
      return NextResponse.json({ success: false, error: "Falta parámetro 'sessionId'" }, { status: 400 })
    }

    switch (action) {
      case "assign":
        return await handleAssign(sessionId, userSession)

      case "close":
        return await handleClose(sessionId, userSession, note)

      case "message":
        return await handleMessage(sessionId, userSession, message)

      default:
        return NextResponse.json({ success: false, error: `Acción no válida: ${action}` }, { status: 400 })
    }
  } catch (error: any) {
    console.error("[API SUPPORT ACTIONS] Error general:", error)
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
      // Verificar si alguien más tomó la sesión (race condition)
      const currentSession = await getSupportSession(sessionId)
      if (currentSession && currentSession.status === "in_progress") {
        console.log("[v0] [ASSIGN] RACE CONDITION: Otro agente tomó la sesión")
        return NextResponse.json(
          { 
            success: false, 
            error: "Otro agente tomó esta conversación. Se actualizará la lista automáticamente.",
            reason: "race_condition"
          }, 
          { status: 409 }
        )
      }
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
    console.log("[v0] [MESSAGE] Iniciando para sessionId:", sessionId)
    console.log("[v0] [MESSAGE] Mensaje recibido:", message)

    // Verificar que es un agente de soporte
    if (session.role !== "support_agent") {
      return NextResponse.json({ success: false, error: "Se requiere rol de agente de soporte" }, { status: 403 })
    }
    
    console.log("[v0] [MESSAGE] Usuario autenticado:", { userId: session.userId, tenantId: session.tenantId })

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      console.log("[v0] [MESSAGE] ERROR: Mensaje inválido")
      return NextResponse.json({ success: false, error: "Mensaje inválido" }, { status: 400 })
    }

    const supportSession = await getSupportSession(sessionId)
    console.log("[v0] [MESSAGE] Sesión encontrada:", supportSession ? "SÍ" : "NO")

    if (!supportSession) {
      console.log("[v0] [MESSAGE] ERROR: Sesión no encontrada")
      return NextResponse.json({ success: false, error: "Sesión no encontrada" }, { status: 404 })
    }

    console.log(
      "[v0] [MESSAGE] Verificando asignación - assignedTo:",
      supportSession.assignedTo,
      "vs userId:",
      session.userId,
    )
    if (supportSession.assignedTo !== session.userId) {
      console.log("[v0] [MESSAGE] ERROR: No estás asignado a esta sesión")
      return NextResponse.json({ success: false, error: "No estás asignado a esta sesión" }, { status: 403 })
    }

    console.log("[v0] [MESSAGE] Status de sesión:", supportSession.status)
    if (supportSession.status !== "in_progress") {
      console.log("[v0] [MESSAGE] ERROR: Sesión no está activa")
      return NextResponse.json({ success: false, error: "Sesión no está activa" }, { status: 400 })
    }

    console.log("[v0] [MESSAGE] Obteniendo config:", supportSession.configId)
    const config = await getWhatsAppConfigById(supportSession.configId)

    if (!config) {
      console.log("[v0] [MESSAGE] ERROR: Configuración no encontrada")
      return NextResponse.json({ success: false, error: "Configuración no encontrada" }, { status: 404 })
    }

    console.log("[v0] [MESSAGE] Config obtenido:", {
      phoneNumberId: config.phoneNumberId,
      hasAccessToken: !!config.accessToken,
      destinationPhone: supportSession.phoneNumber,
    })

    console.log("[v0] [MESSAGE] Enviando mensaje a WhatsApp...")
    await sendWhatsAppMessage(config.phoneNumberId, config.accessToken, supportSession.phoneNumber, message.trim())
    console.log("[v0] [MESSAGE] ✅ Mensaje enviado a WhatsApp exitosamente")

    const supportMessage: HumanSupportMessage = {
      id: nanoid(),
      sessionId,
      role: "agent",
      content: message.trim(),
      timestamp: new Date().toISOString(),
      agentId: session.userId,
    }

    console.log("[v0] [MESSAGE] Guardando mensaje en Redis...")
    await saveSupportMessage(supportMessage)
    console.log("[v0] [MESSAGE] ✅ Mensaje guardado en Redis")

    console.log("[v0] [MESSAGE] ✅ Proceso completo exitoso")
    return NextResponse.json({
      success: true,
      message: "Mensaje enviado correctamente",
    })
  } catch (error: any) {
    console.error("[v0] [MESSAGE] ❌ Error:", error)
    console.error("[v0] [MESSAGE] Stack:", error.stack)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
