import { NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { getWhatsAppConfigsByTenant } from "@/lib/db"
import { getConversationContacts } from "@/lib/conversations"
import { getRedisClient } from "@/lib/redis"

export const dynamic = "force-dynamic"

export interface MonitorContact {
  phoneNumber: string
  lastMessage: string
  lastMessageAt: string
  messageCount: number
  configId: string
  configName: string
  isPaused: boolean          // true = human support active
  supportSessionId?: string  // if paused, the active session id
}

// GET: All chatbot conversations for this agent's tenant
export async function GET(request: Request) {
  try {
    const session = await getSessionFromRequest(request)
    if (!session) {
      return NextResponse.json({ success: false, error: "No autenticado" }, { status: 401 })
    }

    // Get all configs for this tenant
    const configs = await getWhatsAppConfigsByTenant(session.tenantId)
    if (!configs.length) {
      return NextResponse.json({ success: true, contacts: [] })
    }

    const redis = getRedisClient()

    // Gather contacts from all configs in parallel
    const allContactsNested = await Promise.all(
      configs.map(async (config) => {
        const contacts = await getConversationContacts(config.id)
        if (!contacts.length) return []

        // OPTIMIZACIÓN: un solo mget para todos los estados "paused" en lugar de N gets individuales
        // Antes: N requests HTTP separadas (1 por contacto)
        // Ahora: 1 request HTTP con mget batch → ~200× menos reads por poll
        let pausedMap: Map<string, boolean> = new Map()
        try {
          if (redis && contacts.length > 0) {
            const pausedKeys = contacts.map(
              (c) => `conversation_paused:${config.id}:${c.phoneNumber}`
            )
            const pausedVals = await redis.mget<(string | null)[]>(...pausedKeys)
            contacts.forEach((c, i) => {
              const val = pausedVals[i]
              pausedMap.set(c.phoneNumber, val === "true" || (val as any) === true)
            })
          }
        } catch {
          // ignore — pausedMap stays empty (all false)
        }

        // Para los contactos pausados, obtener el sessionId en un solo batch
        const pausedPhones = contacts.filter((c) => pausedMap.get(c.phoneNumber))
        const sessionIdMap: Map<string, string> = new Map()
        if (redis && pausedPhones.length > 0) {
          try {
            const phoneSessionKeys = pausedPhones.map(
              (c) => `human_support:phone:${config.id}:${c.phoneNumber}`
            )
            const sessionIds = await redis.mget<(string | null)[]>(...phoneSessionKeys)
            pausedPhones.forEach((c, i) => {
              if (sessionIds[i]) sessionIdMap.set(c.phoneNumber, sessionIds[i] as string)
            })
          } catch {
            // ignore
          }
        }

        return contacts.map((contact): MonitorContact => ({
          phoneNumber: contact.phoneNumber,
          lastMessage: contact.lastMessage,
          lastMessageAt: contact.lastMessageAt,
          messageCount: contact.messageCount,
          configId: config.id,
          configName: config.displayName || config.alias || config.id,
          isPaused: pausedMap.get(contact.phoneNumber) ?? false,
          supportSessionId: sessionIdMap.get(contact.phoneNumber),
        }))
      })
    )

    const allContacts = allContactsNested
      .flat()
      .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())

    return NextResponse.json({ success: true, contacts: allContacts })
  } catch (error: any) {
    console.error("[API Monitor] Error:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
