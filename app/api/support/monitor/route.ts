import { NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { getWhatsAppConfigsByTenant } from "@/lib/db"
import { getConversationContacts } from "@/lib/conversations"
import { getRedisClient } from "@/lib/redis"
import { getActiveSessionByPhone } from "@/lib/human-support"

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
        return Promise.all(
          contacts.map(async (contact): Promise<MonitorContact> => {
            // Check if conversation is currently paused (human support active)
            let isPaused = false
            let supportSessionId: string | undefined

            try {
              if (redis) {
                const pausedKey = `conversation_paused:${config.id}:${contact.phoneNumber}`
                const pausedVal = await redis.get(pausedKey)
                isPaused = pausedVal === "true" || pausedVal === true
              }
              if (isPaused) {
                const activeSession = await getActiveSessionByPhone(config.id, contact.phoneNumber)
                supportSessionId = activeSession?.id
              }
            } catch {
              // ignore
            }

            return {
              phoneNumber: contact.phoneNumber,
              lastMessage: contact.lastMessage,
              lastMessageAt: contact.lastMessageAt,
              messageCount: contact.messageCount,
              configId: config.id,
              configName: config.displayName || config.alias || config.id,
              isPaused,
              supportSessionId,
            }
          })
        )
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
