import { NextResponse } from "next/server"
import { getRedisClient } from "@/lib/redis"
import { setConversationPaused } from "@/lib/conversations"

// Prefijos Redis (deben coincidir con lib/human-support.ts)
const SUPPORT_SESSION_PREFIX = "human_support:session:"
const SUPPORT_PENDING_SET = "human_support:pending"
const SUPPORT_AGENT_SESSIONS_PREFIX = "human_support:agent:"
const SUPPORT_SESSION_MESSAGES_PREFIX = "human_support:messages:"
const SUPPORT_PHONE_SESSION_PREFIX = "human_support:phone:"

/**
 * POST /api/admin/reset-session
 * Resetea una sesión de soporte por número de teléfono
 * 
 * Body: { phoneNumber: string, configId?: string }
 * 
 * SOLO PARA DESARROLLO/TESTING - En producción debería tener autenticación admin
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { phoneNumber, configId } = body

    if (!phoneNumber) {
      return NextResponse.json(
        { success: false, error: "Se requiere phoneNumber" },
        { status: 400 }
      )
    }

    const redis = getRedisClient()
    if (!redis) {
      return NextResponse.json(
        { success: false, error: "Redis no disponible" },
        { status: 500 }
      )
    }

    console.log("[ADMIN] Buscando sesiones para resetear:", { phoneNumber, configId })

    // Buscar todas las claves de sesiones phone -> sessionId
    const phonePattern = `${SUPPORT_PHONE_SESSION_PREFIX}*:${phoneNumber}`
    const phoneKeys = await redis.keys(phonePattern)
    
    console.log("[ADMIN] Claves de teléfono encontradas:", phoneKeys)

    const resetResults: any[] = []

    for (const phoneKey of phoneKeys) {
      // Obtener el sessionId asociado a este teléfono
      const sessionId = await redis.get(phoneKey as string)
      
      if (sessionId) {
        console.log("[ADMIN] Sesión encontrada:", sessionId)
        
        // Obtener datos de la sesión
        const sessionKey = `${SUPPORT_SESSION_PREFIX}${sessionId}`
        const sessionData = await redis.get(sessionKey)
        
        let session = null
        if (sessionData) {
          session = typeof sessionData === "string" ? JSON.parse(sessionData) : sessionData
        }

        // Eliminar de la lista de pendientes
        await redis.zrem(SUPPORT_PENDING_SET, sessionId as string)
        
        // Eliminar de las sesiones activas del agente (si estaba asignada)
        if (session?.assignedTo) {
          const agentSessionsKey = `${SUPPORT_AGENT_SESSIONS_PREFIX}${session.assignedTo}:active`
          await redis.srem(agentSessionsKey, sessionId as string)
          console.log("[ADMIN] Removido de sesiones del agente:", session.assignedTo)
        }
        
        // Eliminar mensajes de la sesión
        const messagesKey = `${SUPPORT_SESSION_MESSAGES_PREFIX}${sessionId}`
        await redis.del(messagesKey)
        
        // Eliminar la sesión
        await redis.del(sessionKey)
        
        // Eliminar el mapeo phone -> session
        await redis.del(phoneKey as string)
        
        // Despausar la conversación con IA
        if (session?.configId) {
          await setConversationPaused(session.configId, phoneNumber, false)
          console.log("[ADMIN] Conversación despausada para:", phoneNumber)
        }
        
        resetResults.push({
          sessionId,
          phoneKey,
          status: session?.status,
          assignedTo: session?.assignedTo,
          deleted: true
        })
      }
    }

    // También buscar directamente por patrón de sesión si no encontramos por teléfono
    const sessionPattern = `${SUPPORT_SESSION_PREFIX}*`
    const allSessionKeys = await redis.keys(sessionPattern)
    
    for (const sessionKey of allSessionKeys) {
      const sessionData = await redis.get(sessionKey as string)
      if (sessionData) {
        const session = typeof sessionData === "string" ? JSON.parse(sessionData) : sessionData
        
        if (session.phoneNumber === phoneNumber) {
          // Verificar si ya lo procesamos
          const alreadyProcessed = resetResults.some(r => r.sessionId === session.id)
          if (!alreadyProcessed) {
            console.log("[ADMIN] Sesión adicional encontrada por búsqueda directa:", session.id)
            
            // Limpiar todo
            await redis.zrem(SUPPORT_PENDING_SET, session.id)
            
            if (session.assignedTo) {
              const agentSessionsKey = `${SUPPORT_AGENT_SESSIONS_PREFIX}${session.assignedTo}:active`
              await redis.srem(agentSessionsKey, session.id)
            }
            
            const messagesKey = `${SUPPORT_SESSION_MESSAGES_PREFIX}${session.id}`
            await redis.del(messagesKey)
            await redis.del(sessionKey as string)
            
            await setConversationPaused(session.configId, phoneNumber, false)
            
            resetResults.push({
              sessionId: session.id,
              sessionKey,
              status: session.status,
              assignedTo: session.assignedTo,
              deleted: true,
              foundBy: "direct_search"
            })
          }
        }
      }
    }

    if (resetResults.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No se encontraron sesiones para este número",
        phoneNumber,
        resetResults: []
      })
    }

    console.log("[ADMIN] Sesiones reseteadas:", resetResults.length)

    return NextResponse.json({
      success: true,
      message: `Se resetearon ${resetResults.length} sesión(es)`,
      phoneNumber,
      resetResults
    })

  } catch (error: any) {
    console.error("[ADMIN] Error reseteando sesión:", error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}

/**
 * GET /api/admin/reset-session?phone=+1234567890
 * Lista las sesiones activas de un número de teléfono (sin eliminar)
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const phoneNumber = url.searchParams.get("phone")

    const redis = getRedisClient()
    if (!redis) {
      return NextResponse.json(
        { success: false, error: "Redis no disponible" },
        { status: 500 }
      )
    }

    // Si no se especifica teléfono, listar todas las sesiones activas
    if (!phoneNumber) {
      const sessionPattern = `${SUPPORT_SESSION_PREFIX}*`
      const allSessionKeys = await redis.keys(sessionPattern)
      
      const sessions: any[] = []
      for (const key of allSessionKeys) {
        const sessionData = await redis.get(key as string)
        if (sessionData) {
          const session = typeof sessionData === "string" ? JSON.parse(sessionData) : sessionData
          sessions.push({
            id: session.id,
            phoneNumber: session.phoneNumber,
            status: session.status,
            assignedTo: session.assignedTo,
            tenantId: session.tenantId,
            requestedAt: session.requestedAt
          })
        }
      }
      
      return NextResponse.json({
        success: true,
        totalSessions: sessions.length,
        sessions
      })
    }

    // Buscar sesiones específicas del teléfono
    const phonePattern = `${SUPPORT_PHONE_SESSION_PREFIX}*:${phoneNumber}`
    const phoneKeys = await redis.keys(phonePattern)
    
    const sessions: any[] = []
    
    for (const phoneKey of phoneKeys) {
      const sessionId = await redis.get(phoneKey as string)
      if (sessionId) {
        const sessionKey = `${SUPPORT_SESSION_PREFIX}${sessionId}`
        const sessionData = await redis.get(sessionKey)
        if (sessionData) {
          const session = typeof sessionData === "string" ? JSON.parse(sessionData) : sessionData
          sessions.push({
            id: session.id,
            phoneNumber: session.phoneNumber,
            status: session.status,
            assignedTo: session.assignedTo,
            tenantId: session.tenantId,
            configId: session.configId,
            requestedAt: session.requestedAt,
            phoneKey
          })
        }
      }
    }

    return NextResponse.json({
      success: true,
      phoneNumber,
      sessionsFound: sessions.length,
      sessions
    })

  } catch (error: any) {
    console.error("[ADMIN] Error listando sesiones:", error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
