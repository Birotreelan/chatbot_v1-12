import { NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { getWhatsAppConfigsByTenant } from "@/lib/db"
import { getConversationContacts } from "@/lib/conversations"
import { getRedisClient } from "@/lib/redis"

export const dynamic = "force-dynamic"

// Cache TTL para la response del monitor (segundos)
// Reduce reads cuando múltiples instancias/usuarios pollan al mismo tiempo
const MONITOR_CACHE_TTL = 20
const MONITOR_CACHE_KEY_PREFIX = "monitor_cache:"

export interface MonitorContact {
  phoneNumber: string
  lastMessage: string
  lastMessageAt: string
  messageCount: number
  configId: string
  configName: string
  isPaused: boolean
  supportSessionId?: string
}

// GET: All chatbot conversations for this agent's tenant
export async function GET(request: Request) {
  try {
    const session = await getSessionFromRequest(request)
    if (!session) {
      return NextResponse.json({ success: false, error: "No autenticado" }, { status: 401 })
    }

    const redis = getRedisClient()

    // Cache Redis: evita recalcular cuando múltiples polls llegan en la misma ventana de 20s
    // La clave incluye el tenantId para que cada tenant tenga su propio cache
    const cacheKey = `${MONITOR_CACHE_KEY_PREFIX}${session.tenantId}`
    if (redis) {
      try {
        const cached = await redis.get(cacheKey)
        if (cached) {
          const parsed = typeof cached === "string" ? JSON.parse(cached) : cached
          if (parsed?.contacts) {
            return NextResponse.json({ success: true, contacts: parsed.contacts, _cached: true })
          }
        }
      } catch {
        // cache miss — continuar con lectura normal
      }
    }

    // Get all configs for this tenant
    const configs = await getWhatsAppConfigsByTenant(session.tenantId)
    if (!configs.length) {
      return NextResponse.json({ success: true, contacts: [] })
    }

    // Gather contacts from all configs in parallel
    const allContactsNested = await Promise.all(
      configs.map(async (config) => {
        const contacts = await getConversationContacts(config.id)
        if (!contacts.length) return []

        // mget batch para todos los estados "paused" — 1 request en lugar de N
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
          // ignorar — pausedMap queda vacío (todos false)
        }

        // mget batch para sessionIds de contactos pausados
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
            // ignorar
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

    // Guardar en cache Redis
    if (redis) {
      try {
        await redis.setex(cacheKey, MONITOR_CACHE_TTL, JSON.stringify({ contacts: allContacts }))
      } catch {
        // fallar silenciosamente
      }
    }

    return NextResponse.json({ success: true, contacts: allContacts })
  } catch (error: any) {
    console.error("[API Monitor] Error:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

// Exportar para invalidar el cache cuando hay una nueva sesión de soporte
export function invalidateMonitorCache(tenantId: string): void {
  const redis = getRedisClient()
  if (!redis) return
  redis.del(`${MONITOR_CACHE_KEY_PREFIX}${tenantId}`).catch(() => {})
}
