import { getRedisClient } from "./redis"
import { nanoid } from "nanoid"
import type { HumanSupportSession, HumanSupportMessage, ConversationMessage } from "./types"
import { setConversationPaused } from "./conversations"

// Prefijos Redis
const SUPPORT_SESSION_PREFIX = "human_support:session:"
const SUPPORT_PENDING_SET = "human_support:pending"
const SUPPORT_AGENT_SESSIONS_PREFIX = "human_support:agent:"
const SUPPORT_SESSION_MESSAGES_PREFIX = "human_support:messages:"
const SUPPORT_PHONE_SESSION_PREFIX = "human_support:phone:"

// TTL para sesiones resueltas (7 días)
const RESOLVED_SESSION_TTL = 7 * 24 * 60 * 60

interface CreateSupportSessionParams {
  phoneNumber: string
  configId: string
  tenantId: string
  threadId: string
  assistantId: string
  displayName: string
  reason: string
  priority: "low" | "medium" | "high"
  summary: string
}

// Crear una nueva sesión de soporte
export async function createSupportSession(params: CreateSupportSessionParams): Promise<HumanSupportSession> {
  const redis = getRedisClient()
  if (!redis) {
    throw new Error("Redis no disponible")
  }

  const sessionId = nanoid()
  const now = new Date().toISOString()

  const session: HumanSupportSession = {
    id: sessionId,
    phoneNumber: params.phoneNumber,
    configId: params.configId,
    tenantId: params.tenantId,
    status: "pending",
    priority: params.priority,
    reason: params.reason,
    summary: params.summary,
    threadId: params.threadId,
    assistantId: params.assistantId,
    displayName: params.displayName,
    requestedAt: now,
    assignedTo: null,
    assignedAt: null,
    resolvedAt: null,
    pendingMessages: [],
  }

  // Guardar sesión en Redis
  const sessionKey = `${SUPPORT_SESSION_PREFIX}${sessionId}`
  await redis.set(sessionKey, JSON.stringify(session))

  // Agregar a la lista de pendientes (sorted set por timestamp para ordenar por tiempo)
  const timestamp = Date.now()
  await redis.zadd(SUPPORT_PENDING_SET, { score: timestamp, member: sessionId })

  // Mapear teléfono a sessionId para búsqueda rápida
  const phoneSessionKey = `${SUPPORT_PHONE_SESSION_PREFIX}${params.configId}:${params.phoneNumber}`
  await redis.set(phoneSessionKey, sessionId)

  // Pausar la conversación con IA
  await setConversationPaused(params.configId, params.phoneNumber, true)

  console.log(`[HUMAN_SUPPORT] ✅ Sesión creada: ${sessionId} para ${params.phoneNumber}`)

  return session
}

// Obtener sesión activa por teléfono
export async function getActiveSessionByPhone(
  configId: string,
  phoneNumber: string,
): Promise<HumanSupportSession | null> {
  const redis = getRedisClient()
  if (!redis) return null

  const phoneSessionKey = `${SUPPORT_PHONE_SESSION_PREFIX}${configId}:${phoneNumber}`
  const sessionId = await redis.get(phoneSessionKey)

  if (!sessionId) return null

  return await getSupportSession(sessionId as string)
}

// Obtener sesión por ID
export async function getSupportSession(sessionId: string): Promise<HumanSupportSession | null> {
  const redis = getRedisClient()
  if (!redis) return null

  const sessionKey = `${SUPPORT_SESSION_PREFIX}${sessionId}`
  const sessionData = await redis.get(sessionKey)

  if (!sessionData) return null

  const session = typeof sessionData === "string" ? JSON.parse(sessionData) : sessionData

  return session as HumanSupportSession
}

// Obtener sesiones pendientes (filtradas por tenant si aplica)
export async function getPendingSessions(tenantId: string | null = null): Promise<HumanSupportSession[]> {
  const redis = getRedisClient()
  if (!redis) return []

  console.log("[HUMAN_SUPPORT] getPendingSessions llamado con tenantId:", tenantId)

  // Obtener todos los sessionIds pendientes (ordenados por timestamp)
  const sessionIds = await redis.zrange(SUPPORT_PENDING_SET, 0, -1)

  console.log("[HUMAN_SUPPORT] SessionIds pendientes en Redis:", sessionIds)

  if (!sessionIds || sessionIds.length === 0) {
    console.log("[HUMAN_SUPPORT] No hay sesiones pendientes en Redis")
    return []
  }

  const sessions: HumanSupportSession[] = []

  for (const sessionId of sessionIds) {
    const session = await getSupportSession(sessionId as string)
    if (session) {
      console.log("[HUMAN_SUPPORT] Sesión encontrada:", {
        id: session.id,
        tenantId: session.tenantId,
        configId: session.configId,
        status: session.status,
        phoneNumber: session.phoneNumber
      })
      // Filtrar por tenant si no es super admin
      if (tenantId === null || session.tenantId === tenantId) {
        console.log("[HUMAN_SUPPORT] Sesión INCLUIDA (tenantId coincide o es null)")
        sessions.push(session)
      } else {
        console.log("[HUMAN_SUPPORT] Sesión EXCLUIDA - tenantId no coincide:", session.tenantId, "vs", tenantId)
      }
    }
  }

  console.log("[HUMAN_SUPPORT] Total sesiones filtradas:", sessions.length)
  return sessions
}

// Obtener sesiones activas de un agente
export async function getAgentActiveSessions(agentId: string): Promise<HumanSupportSession[]> {
  const redis = getRedisClient()
  if (!redis) return []

  const agentSessionsKey = `${SUPPORT_AGENT_SESSIONS_PREFIX}${agentId}:active`
  const sessionIds = await redis.smembers(agentSessionsKey)

  if (!sessionIds || sessionIds.length === 0) return []

  const sessions: HumanSupportSession[] = []

  for (const sessionId of sessionIds) {
    const session = await getSupportSession(sessionId as string)
    if (session && session.status === "in_progress") {
      sessions.push(session)
    }
  }

  return sessions
}

// Asignar sesión a un agente (con bloqueo atómico para evitar race conditions)
export async function assignSessionToAgent(sessionId: string, agentId: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false

  // Crear clave de lock única para esta sesión
  const lockKey = `human_support:lock:${sessionId}`
  const lockValue = `${agentId}:${Date.now()}`
  const lockTTL = 30 // segundos

  // Intentar adquirir el lock de forma atómica (solo si no existe)
  const lockAcquired = await redis.set(lockKey, lockValue, {
    NX: true, // Only set if not exists
    EX: lockTTL, // Expiración automática en caso de error
  })

  // Si no pudimos adquirir el lock, otro agente está procesando esta sesión
  if (!lockAcquired) {
    console.log(`[HUMAN_SUPPORT] ⚠️ No se pudo adquirir lock para sesión ${sessionId} - ya está siendo procesada`)
    return false
  }

  try {
    // Obtener sesión dentro del lock para verificar estado actual
    const session = await getSupportSession(sessionId)

    // Verificar que la sesión existe y sigue pendiente
    if (!session || session.status !== "pending") {
      console.log(`[HUMAN_SUPPORT] ⚠️ Sesión ${sessionId} no está disponible (estado: ${session?.status})`)
      return false
    }

    const now = new Date().toISOString()

    // Actualizar sesión
    session.status = "in_progress"
    session.assignedTo = agentId
    session.assignedAt = now

    const sessionKey = `${SUPPORT_SESSION_PREFIX}${sessionId}`
    await redis.set(sessionKey, JSON.stringify(session))

    // Remover de pendientes
    await redis.zrem(SUPPORT_PENDING_SET, sessionId)

    // Agregar a sesiones activas del agente
    const agentSessionsKey = `${SUPPORT_AGENT_SESSIONS_PREFIX}${agentId}:active`
    await redis.sadd(agentSessionsKey, sessionId)

    console.log(`[HUMAN_SUPPORT] ✅ Sesión ${sessionId} asignada a agente ${agentId}`)

    return true
  } finally {
    // Liberar el lock siempre, incluso si hay error
    await redis.del(lockKey)
  }
}

// Cerrar sesión y devolver a IA
export async function closeSession(sessionId: string, note?: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false

  const session = await getSupportSession(sessionId)
  if (!session) return false

  const now = new Date().toISOString()

  // Actualizar sesión
  session.status = "resolved"
  session.resolvedAt = now

  const sessionKey = `${SUPPORT_SESSION_PREFIX}${sessionId}`
  await redis.set(sessionKey, JSON.stringify(session))
  await redis.expire(sessionKey, RESOLVED_SESSION_TTL)

  // Remover de sesiones activas del agente
  if (session.assignedTo) {
    const agentSessionsKey = `${SUPPORT_AGENT_SESSIONS_PREFIX}${session.assignedTo}:active`
    await redis.srem(agentSessionsKey, sessionId)
  }

  // Remover mapeo de teléfono
  const phoneSessionKey = `${SUPPORT_PHONE_SESSION_PREFIX}${session.configId}:${session.phoneNumber}`
  await redis.del(phoneSessionKey)

  // Reanudar conversación con IA
  await setConversationPaused(session.configId, session.phoneNumber, false)

  console.log(`[HUMAN_SUPPORT] ✅ Sesión ${sessionId} cerrada y devuelta a IA`)

  return true
}

// Agregar mensaje pendiente a la sesión (cuando el usuario escribe mientras espera)
export async function addPendingMessageToSession(sessionId: string, message: ConversationMessage): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false

  const session = await getSupportSession(sessionId)
  if (!session) return false

  // Agregar mensaje a la lista de pendientes
  session.pendingMessages.push(message)

  const sessionKey = `${SUPPORT_SESSION_PREFIX}${sessionId}`
  await redis.set(sessionKey, JSON.stringify(session))

  console.log(`[HUMAN_SUPPORT] 📨 Mensaje pendiente agregado a sesión ${sessionId}`)

  return true
}

// Guardar mensaje de la sesión de soporte
export async function saveSupportMessage(message: HumanSupportMessage): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  const messagesKey = `${SUPPORT_SESSION_MESSAGES_PREFIX}${message.sessionId}`
  await redis.rpush(messagesKey, JSON.stringify(message))
  await redis.expire(messagesKey, RESOLVED_SESSION_TTL)

  console.log(`[HUMAN_SUPPORT] 💬 Mensaje guardado en sesión ${message.sessionId}`)
}

// Obtener mensajes de una sesión de soporte
export async function getSupportMessages(sessionId: string): Promise<HumanSupportMessage[]> {
  const redis = getRedisClient()
  if (!redis) return []

  const messagesKey = `${SUPPORT_SESSION_MESSAGES_PREFIX}${sessionId}`
  const messages = await redis.lrange(messagesKey, 0, -1)

  if (!messages || messages.length === 0) return []

  return messages
    .map((msg) => {
      try {
        return typeof msg === "string" ? JSON.parse(msg) : msg
      } catch {
        return null
      }
    })
    .filter(Boolean) as HumanSupportMessage[]
}

// Verificar si un teléfono tiene sesión activa
export async function hasActiveSession(configId: string, phoneNumber: string): Promise<boolean> {
  const session = await getActiveSessionByPhone(configId, phoneNumber)
  return session !== null && (session.status === "pending" || session.status === "in_progress")
}
