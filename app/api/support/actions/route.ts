import { NextResponse } from "next/server"
import { requireAuthFromRequest, requireSupportAgentFromRequest, getSessionFromRequest } from "@/lib/auth"
import type { SessionData } from "@/lib/types"
import {
  getSupportSession,
  getSupportMessages,
  assignSessionToAgent,
  closeSession,
  saveSupportMessage,
  createSupportSession,
  getActiveSessionByPhone,
} from "@/lib/human-support"
import { getConversationMessages, getAllConversationMessages } from "@/lib/conversations"
import { getWhatsAppConfigById, getThreadForUser } from "@/lib/db"
import { sendWhatsAppMessage } from "@/lib/whatsapp-api"
import { openai } from "@/lib/openai"
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

    // Obtener historial con paginacion (ultimos 100 mensajes para soporte)
    const { messages: conversationHistory } = await getConversationMessages(supportSession.configId, supportSession.phoneNumber, 100, 0)
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
    const { action, sessionId, message, note, phoneNumber, configId } = body

    console.log("[v0] [API SUPPORT ACTIONS] Datos recibidos:", { action, sessionId })

    if (!action) {
      return NextResponse.json({ success: false, error: "Falta parámetro 'action'" }, { status: 400 })
    }

    // "initiate" doesn't need a sessionId — it creates one
    if (action !== "initiate" && !sessionId) {
      return NextResponse.json({ success: false, error: "Falta parámetro 'sessionId'" }, { status: 400 })
    }

    switch (action) {
      case "initiate":
        return await handleInitiate(phoneNumber, configId, userSession)

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

// Initiate: manually start a support session from the monitor (without AI tool)
async function handleInitiate(phoneNumber: string, configId: string, session: SessionData) {
  try {
    console.log("[v0] [INITIATE] Iniciando para phone:", phoneNumber, "config:", configId)

    if (session.role !== "support_agent") {
      return NextResponse.json({ success: false, error: "Se requiere rol de agente de soporte" }, { status: 403 })
    }

    if (!phoneNumber || !configId) {
      return NextResponse.json({ success: false, error: "Faltan parámetros phoneNumber o configId" }, { status: 400 })
    }

    // Check if there's already an active session
    const existing = await getActiveSessionByPhone(configId, phoneNumber)
    if (existing && (existing.status === "pending" || existing.status === "in_progress")) {
      console.log("[v0] [INITIATE] Ya existe sesión activa:", existing.id)
      return NextResponse.json({ success: false, error: "Ya existe una sesión activa para este número", sessionId: existing.id }, { status: 409 })
    }

    const config = await getWhatsAppConfigById(configId)
    if (!config) {
      return NextResponse.json({ success: false, error: "Configuración no encontrada" }, { status: 404 })
    }

    // Verify tenant
    if (session.tenantId && config.cliente_id !== session.tenantId) {
      return NextResponse.json({ success: false, error: "No autorizado para esta configuración" }, { status: 403 })
    }

    // Get or create a thread for this user (needed for session)
    const { threadId } = await getThreadForUser(phoneNumber, configId)

    // Create the support session
    const supportSession = await createSupportSession({
      phoneNumber,
      configId,
      tenantId: config.cliente_id,
      threadId,
      assistantId: config.whatsappAssistantId || "",
      displayName: config.displayName || config.alias || configId,
      reason: "Intervención manual del agente",
      priority: "medium",
      summary: "Un agente ha iniciado la atención desde el monitor de conversaciones.",
    })

    console.log("[v0] [INITIATE] Sesión creada:", supportSession.id)

    // Auto-assign to the initiating agent
    await assignSessionToAgent(supportSession.id, session.userId)

    // Notify the patient
    try {
      const notification = `Una persona de atención al paciente de ${config.displayName || "la clínica"} está hablando ahora contigo.`
      await sendWhatsAppMessage(config.phoneNumberId, config.accessToken, phoneNumber, notification)
      console.log("[v0] [INITIATE] Notificación enviada al paciente")
    } catch (err) {
      console.error("[v0] [INITIATE] Error enviando notificación:", err)
    }

    return NextResponse.json({
      success: true,
      sessionId: supportSession.id,
      message: "Sesión iniciada y asignada correctamente",
    })
  } catch (error: any) {
    console.error("[v0] [INITIATE] Error:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

async function handleAssign(sessionId: string, session: SessionData) {
  console.log("[v0] [ASSIGN] Iniciando para sessionId:", sessionId)
  console.log("[v0] [ASSIGN] Usuario SSO - ID:", session.ssoUsuarioId, "Display:", session.displayName)

  try {
    // Verificar que es un agente de soporte
    if (session.role !== "support_agent") {
      return NextResponse.json({ success: false, error: "Se requiere rol de agente de soporte" }, { status: 403 })
    }
    
    console.log("[v0] [ASSIGN] Usuario autenticado:", { 
      userId: session.userId, 
      tenantId: session.tenantId,
      ssoUsuarioId: session.ssoUsuarioId,
      displayName: session.displayName
    })

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

    console.log("[v0] [ASSIGN] ✓ Asignando sesión al agente:", {
      sessionId,
      agentUserId: session.userId,
      agentSsoId: session.ssoUsuarioId,
      agentName: session.displayName
    })
    
    const assigned = await assignSessionToAgent(sessionId, session.userId)
    console.log("[v0] [ASSIGN] Resultado de asignación:", assigned ? "✓ ÉXITO" : "✗ FALLÓ")

    if (!assigned) {
      console.log("[v0] [ASSIGN] ERROR: No se pudo asignar")
      // Verificar si alguien más tomó la sesión (race condition)
      const currentSession = await getSupportSession(sessionId)
      if (currentSession && currentSession.status === "in_progress") {
        console.log("[v0] [ASSIGN] ⚠️ RACE CONDITION: Otro agente tomó la sesión")
        console.log("[v0] [ASSIGN] Sesión ahora asignada a:", currentSession.assignedTo)
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
        const message = `Una persona está conectada y te ayudará en breve`
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

    // Collect human support messages BEFORE closing
    const supportMessages = await getSupportMessages(sessionId)

    const closed = await closeSession(sessionId, note)

    if (!closed) {
      return NextResponse.json({ success: false, error: "No se pudo cerrar la sesión" }, { status: 500 })
    }

    // Inject human conversation context into OpenAI thread so AI has context on resume
    if (supportMessages.length > 0 && supportSession.threadId) {
      try {
        const agentLines = supportMessages
          .filter((m) => m.role === "agent")
          .map((m) => `Agente: ${m.content}`)
          .join("\n")

        const userLines = supportMessages
          .filter((m) => m.role === "user")
          .map((m) => `Paciente: ${m.content}`)
          .join("\n")

        const allLines = supportMessages
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
          .map((m) => `${m.role === "agent" ? "Agente" : "Paciente"}: ${m.content}`)
          .join("\n")

        const contextBlock = `[ATENCION_HUMANA]
Un agente humano atendió al paciente. A continuación el resumen de la conversación:

${allLines}

El agente cerró la sesión. Retomá la conversación teniendo en cuenta lo que se habló.
[/ATENCION_HUMANA]`

        await openai.beta.threads.messages.create(supportSession.threadId, {
          role: "user",
          content: contextBlock,
        })
        console.log("[CLOSE] Contexto de sesión humana inyectado en thread:", supportSession.threadId)
      } catch (err) {
        console.error("[CLOSE] Error inyectando contexto:", err)
      }
    }

    // Enviar mensaje automático al paciente
    try {
      const config = await getWhatsAppConfigById(supportSession.configId)
      if (config) {
        const message = `Has sido reconectado al asistente virtual. Si enviás un nuevo mensaje, la respuesta será generada automáticamente.`
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
