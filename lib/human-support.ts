import { getRedisClient } from "./redis"
import { nanoid } from "nanoid"
import type { HumanSupportSession, HumanSupportMessage, ConversationMessage } from "./types"
import { setConversationPaused } from "./conversations"
import { getWhatsAppConfigById } from "./db"
import { sendWhatsAppMessage } from "./whatsapp-api"
import { anotarArchivosEnMotivo, MOTIVO_ARCHIVO } from "./media-entrante"

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

/**
 * Registra que el paciente mandó un archivo, creando o actualizando la sesión
 * de atención (21/9/2026).
 *
 * ── Por qué está acá y no en whatsapp.tsx ──────────────────────────────────
 *
 * Porque necesita un lock, y el lock necesita las claves de este módulo.
 *
 * Un paciente que fotografía una orden médica manda cuatro o cinco fotos
 * seguidas. Cada una es un webhook, y la cola por usuario (`enqueueUserMessage`)
 * recién actúa al final de `handleMessage`: estos bloques tempranos NO están
 * serializados. Sin lock, dos webhooks casi simultáneos ven los dos que no hay
 * sesión, crean dos, y la segunda pisa el puntero `human_support:phone:…`
 * dejando la primera huérfana — con el primer archivo adentro, invisible para
 * todos.
 *
 * Mismo patrón de lock que `assignSessionToAgent`, por el mismo motivo.
 *
 * ── Qué devuelve ───────────────────────────────────────────────────────────
 *
 *  - `creada`: no había sesión; se derivó al paciente (regla 1).
 *  - `anotada`: ya había una esperando agente; se le sumó el archivo al motivo,
 *    para que quien la tome sepa cuántos lo esperan antes de abrirla (regla 3).
 *  - `abierta`: un agente ya la tiene asignada. No se toca el motivo: el archivo
 *    aparece solo en la conversación, que es donde el agente está mirando.
 *  - `en_curso`: otro webhook del mismo paciente está haciendo esto ahora mismo.
 *  - `null`: Redis no disponible. Esto sí es una falla.
 */
export type RegistroDeArchivo =
  | { resultado: "creada" | "anotada" | "abierta"; session: HumanSupportSession }
  | { resultado: "en_curso"; session: null }
  | null

export async function registrarArchivoEntrante(params: {
  configId: string
  phoneNumber: string
  tenantId: string
  threadId: string
  assistantId: string
  displayName: string
}): Promise<RegistroDeArchivo> {
  const redis = getRedisClient()
  if (!redis) return null

  const lockKey = `human_support:lock:archivo:${params.configId}:${params.phoneNumber}`

  // Se espera el lock en vez de rendirse en el primer intento.
  //
  // Rendirse era un error con consecuencia visible: el webhook que perdía la
  // carrera miraba si ya había sesión, no la encontraba —porque el que tenía el
  // lock todavía la estaba creando— y devolvía null. El llamador interpretaba
  // eso como "no se pudo derivar" y le decía al paciente que hubo un problema,
  // mientras el otro webhook lo estaba derivando perfectamente.
  //
  // Crear una sesión son tres escrituras a Redis: 250 ms por intento alcanzan
  // de sobra, y el peor caso es un segundo en un camino que casi nunca se toma.
  let lockAcquired: unknown = null
  for (let intento = 0; intento < 4 && !lockAcquired; intento++) {
    if (intento > 0) await new Promise((r) => setTimeout(r, 250))
    // En minúscula. El cliente de Upstash hace `"nx" in opts`: con `NX` en
    // mayúscula la opción se ignora en silencio y el `set` pasa a ser
    // incondicional — es decir, el lock no bloquea nada. Ver la nota en
    // assignSessionToAgent.
    lockAcquired = await redis.set(lockKey, Date.now().toString(), { nx: true, ex: 15 })
  }

  if (!lockAcquired) {
    // Cuatro intentos y el lock sigue tomado. El archivo ya está guardado en el
    // historial de la conversación, que es de donde el panel arma los mensajes,
    // así que no se pierde: lo único que no pasó es sumarlo a la cuenta del
    // motivo. `en_curso` existe para que el llamador se quede callado en vez de
    // alarmar al paciente por algo que otro webhook está resolviendo bien.
    console.log(`[HUMAN_SUPPORT] Lock de archivo ocupado para ${params.phoneNumber}; lo maneja otro webhook`)
    return { resultado: "en_curso", session: null }
  }

  try {
    const existente = await getActiveSessionByPhone(params.configId, params.phoneNumber)

    if (existente && (existente.status === "pending" || existente.status === "in_progress")) {
      if (existente.status === "in_progress") {
        return { resultado: "abierta", session: existente }
      }

      existente.reason = anotarArchivosEnMotivo(existente.reason)
      await redis.set(`${SUPPORT_SESSION_PREFIX}${existente.id}`, JSON.stringify(existente))
      console.log(`[HUMAN_SUPPORT] 📎 Archivo sumado al motivo de ${existente.id}: "${existente.reason}"`)
      return { resultado: "anotada", session: existente }
    }

    const session = await createSupportSession({
      phoneNumber: params.phoneNumber,
      configId: params.configId,
      tenantId: params.tenantId,
      threadId: params.threadId,
      assistantId: params.assistantId,
      displayName: params.displayName,
      reason: anotarArchivosEnMotivo(MOTIVO_ARCHIVO),
      priority: "medium",
      summary:
        "El paciente envió un archivo por WhatsApp. Se derivó automáticamente porque el asistente no puede interpretarlo.",
    })

    console.log(`[HUMAN_SUPPORT] 📎 Sesión creada por archivo entrante: ${session.id}`)
    return { resultado: "creada", session }
  } finally {
    await redis.del(lockKey)
  }
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
// OPTIMIZACIÓN: usa pipeline para agrupar todos los GETs en una sola request HTTP
// Antes: 1 zrange + N gets individuales = N+1 requests
// Ahora: 1 zrange + 1 pipeline con N gets = 2 requests
//
// ── El estado manda, no la pertenencia al sorted set (23/9/2026) ───────────
//
// Esta función confiaba enteramente en `human_support:pending`: si el id estaba
// en el sorted set, la sesión contaba como pendiente, sin mirarle el `status`.
// `getAgentActiveSessions`, tres líneas más abajo, sí verifica
// `status === "in_progress"`. Dos implementaciones de la misma pregunta que se
// responden distinto, y el widget de notificaciones del cliente pagó la
// diferencia: mostraba "Pendientes: 2" con el panel vacío.
//
// El desfasaje era real. `closeSession` no sacaba el id del sorted set, así que
// toda sesión cerrada SIN haber sido asignada —el cierre masivo al apagar la
// atención humana, o un admin cerrando desde la lista sin tomarla— quedaba
// adentro como fantasma durante los 7 días del TTL de sesiones resueltas.
//
// Ahora el `status` es la única fuente de verdad y el sorted set es un índice:
// si discrepan, gana el status y el índice se corrige. Se limpia acá además de
// en `closeSession` para que los fantasmas ya colgados se vayan solos, sin
// tener que tocar Redis a mano.
export async function getPendingSessions(tenantId: string | null = null): Promise<HumanSupportSession[]> {
  const redis = getRedisClient()
  if (!redis) return []

  // Obtener todos los sessionIds pendientes (ordenados por timestamp)
  const sessionIds = await redis.zrange(SUPPORT_PENDING_SET, 0, -1)

  if (!sessionIds || sessionIds.length === 0) return []

  // Pipeline: todos los GETs en una sola request HTTP
  const pipeline = redis.pipeline()
  for (const sessionId of sessionIds) {
    pipeline.get(`${SUPPORT_SESSION_PREFIX}${sessionId}`)
  }
  const results = await pipeline.exec()

  const sessions: HumanSupportSession[] = []
  const aLimpiar: string[] = []

  // Se recorre por índice para conservar el sessionId de cada resultado: sin él
  // no se puede limpiar la entrada que sobra.
  for (let i = 0; i < sessionIds.length; i++) {
    const sessionId = String(sessionIds[i])
    const raw = results[i]

    // La sesión ya no existe (venció su TTL). La entrada del índice no vence
    // sola, así que hay que sacarla explícitamente o se acumula para siempre.
    if (!raw) {
      aLimpiar.push(sessionId)
      continue
    }

    let session: HumanSupportSession | null = null
    try {
      session = (typeof raw === "string" ? JSON.parse(raw) : raw) as HumanSupportSession
    } catch {
      aLimpiar.push(sessionId)
      continue
    }

    if (!session) {
      aLimpiar.push(sessionId)
      continue
    }

    // Ya no está pendiente: asignada, resuelta o lo que sea. Fuera del índice.
    //
    // Se limpia sin importar el tenant. Un fantasma de otra clínica sigue
    // siendo un fantasma, y dejarlo obligaría a que justo esa clínica consulte
    // para que se limpie.
    if (session.status !== "pending") {
      aLimpiar.push(sessionId)
      continue
    }

    if (tenantId === null || session.tenantId === tenantId) {
      sessions.push(session)
    }
  }

  // Best-effort: el conteo que se devuelve ya es correcto aunque esto falle.
  // En régimen normal no hay nada para limpiar y no se escribe nada.
  if (aLimpiar.length > 0) {
    try {
      await redis.zrem(SUPPORT_PENDING_SET, ...aLimpiar)
      console.log(
        `[HUMAN_SUPPORT] 🧹 ${aLimpiar.length} sesión(es) fantasma sacadas del índice de pendientes: ${aLimpiar.join(", ")}`,
      )
    } catch (error) {
      console.error("[HUMAN_SUPPORT] No se pudo limpiar el índice de pendientes:", error)
    }
  }

  return sessions
}

// Obtener sesiones activas de un agente
// OPTIMIZACIÓN: pipeline para agrupar los GETs de sesión
export async function getAgentActiveSessions(agentId: string): Promise<HumanSupportSession[]> {
  const redis = getRedisClient()
  if (!redis) return []

  const agentSessionsKey = `${SUPPORT_AGENT_SESSIONS_PREFIX}${agentId}:active`
  const sessionIds = await redis.smembers(agentSessionsKey)

  if (!sessionIds || sessionIds.length === 0) return []

  // Pipeline: todos los GETs en una sola request HTTP
  const pipeline = redis.pipeline()
  for (const sessionId of sessionIds) {
    pipeline.get(`${SUPPORT_SESSION_PREFIX}${sessionId}`)
  }
  const results = await pipeline.exec()

  const sessions: HumanSupportSession[] = []
  for (const raw of results) {
    if (!raw) continue
    try {
      const session = (typeof raw === "string" ? JSON.parse(raw) : raw) as HumanSupportSession
      if (session && session.status === "in_progress") {
        sessions.push(session)
      }
    } catch {
      // skip malformed session
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
  //
  // 21/9/2026: estas opciones estaban en MAYÚSCULA (`NX`/`EX`), que es la
  // sintaxis de node-redis. El cliente de Upstash las busca en minúscula
  // (`"nx" in opts`), así que las ignoraba: el `set` era incondicional, siempre
  // devolvía "OK" y el lock nunca bloqueó a nadie. Lo único que evitaba la doble
  // asignación era el chequeo de `status !== "pending"` de abajo, que es un
  // read-then-write y no es atómico. De paso, sin `EX` la clave del lock tampoco
  // expiraba: quedaba una por cada sesión asignada, para siempre.
  const lockAcquired = await redis.set(lockKey, lockValue, {
    nx: true, // Only set if not exists
    ex: lockTTL, // Expiración automática en caso de error
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
    await touchSupportSessionActivity(sessionId)

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
  await touchSupportSessionActivity(sessionId)

  // Remover del índice de pendientes (23/9/2026)
  //
  // Esta línea faltaba. Casi siempre no hacía falta —pendiente → asignada →
  // cerrada, y `assignSessionToAgent` ya la había sacado— pero una sesión que
  // se cierra SIN haber sido asignada nunca pasa por ahí: el cierre masivo al
  // apagar la atención humana y el cierre de un admin desde la lista son los
  // dos caminos reales. Quedaba en el índice, y el widget del cliente la
  // seguía contando como pendiente durante una semana.
  //
  // Incondicional a propósito: preguntar antes por el estado sería otra
  // oportunidad de que los dos se desfasen. Sacarla cuando ya no está es un
  // no-op barato.
  await redis.zrem(SUPPORT_PENDING_SET, sessionId)

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

// ============================================================================
// MARCADOR DE ACTIVIDAD DE SESIÓN (optimización bandwidth 2026-07-06)
// Clave diminuta (~15 bytes) que se actualiza en cada cambio de la sesión.
// El polling del panel de soporte la lee para responder "unchanged" sin
// transferir la sesión + 100 mensajes de conversación en cada poll.
// ============================================================================
const SUPPORT_SESSION_ACTIVITY_PREFIX = "support_session_activity:"
const SESSION_ACTIVITY_TTL = 7 * 24 * 60 * 60 // 7 días

export async function touchSupportSessionActivity(sessionId: string): Promise<void> {
  try {
    const redis = getRedisClient()
    if (!redis) return
    await redis.setex(`${SUPPORT_SESSION_ACTIVITY_PREFIX}${sessionId}`, SESSION_ACTIVITY_TTL, Date.now().toString())
  } catch {
    // best-effort
  }
}

export async function getSupportSessionActivity(sessionId: string): Promise<number | null> {
  try {
    const redis = getRedisClient()
    if (!redis) return null
    const val = await redis.get(`${SUPPORT_SESSION_ACTIVITY_PREFIX}${sessionId}`)
    if (!val) return null
    const num = Number(val)
    return Number.isFinite(num) ? num : null
  } catch {
    return null
  }
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
  await touchSupportSessionActivity(sessionId)

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
  await touchSupportSessionActivity(message.sessionId)

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

// ─── Cierre masivo de sesiones (toggle del flag maestro "humanSupport") ────
// Cuando la clínica apaga "Atención Humana" desde su propio Panel de Atención
// Treelan Iris, las sesiones individuales que sigan abiertas (pending o
// in_progress) deben cerrarse automáticamente y devolverse a la IA. Los
// administradores de Treelan no deben tener que cerrarlas a mano una por una.
async function scanSupportSessionKeys(redisClient: NonNullable<ReturnType<typeof getRedisClient>>): Promise<string[]> {
  const allKeys: string[] = []
  let cursor = "0"
  do {
    const result = await redisClient.scan(cursor, { match: `${SUPPORT_SESSION_PREFIX}*`, count: 100 })
    cursor = typeof result[0] === "number" ? result[0].toString() : result[0]
    allKeys.push(...result[1])
  } while (cursor !== "0")
  return allKeys
}

export async function closeAllActiveSessionsForConfig(
  configId: string,
  note: string = "Cerrada automáticamente: atención humana desactivada desde el panel",
): Promise<{ closedCount: number }> {
  const redis = getRedisClient()
  if (!redis) return { closedCount: 0 }

  const keys = await scanSupportSessionKeys(redis)
  if (keys.length === 0) return { closedCount: 0 }

  // Traer todas las sesiones en pipeline para filtrar por configId + estado activo
  const pipeline = redis.pipeline()
  for (const key of keys) {
    pipeline.get(key)
  }
  const results = await pipeline.exec()

  const activeSessionIds: string[] = []
  for (const raw of results) {
    if (!raw) continue
    try {
      const session = (typeof raw === "string" ? JSON.parse(raw) : raw) as HumanSupportSession
      if (
        session &&
        session.configId === configId &&
        (session.status === "pending" || session.status === "in_progress")
      ) {
        activeSessionIds.push(session.id)
      }
    } catch {
      // skip malformed session
    }
  }

  if (activeSessionIds.length === 0) return { closedCount: 0 }

  let config: Awaited<ReturnType<typeof getWhatsAppConfigById>> = null
  try {
    config = await getWhatsAppConfigById(configId)
  } catch (error) {
    console.error(`[HUMAN_SUPPORT] Error obteniendo config ${configId} para notificar cierre masivo:`, error)
  }

  let closedCount = 0
  for (const sessionId of activeSessionIds) {
    // Leemos la sesión (para el teléfono) ANTES de cerrarla, ya que closeSession no lo devuelve
    const session = await getSupportSession(sessionId)
    const closed = await closeSession(sessionId, note)
    if (!closed) continue
    closedCount++

    if (config && session) {
      try {
        const message = `Has sido reconectado con el asistente virtual. ¡Gracias por tu paciencia! 🤖`
        await sendWhatsAppMessage(config.phoneNumberId, config.accessToken, session.phoneNumber, message)
      } catch (error) {
        console.error(
          `[HUMAN_SUPPORT] Error enviando mensaje de reconexión (cierre masivo) a ${session.phoneNumber}:`,
          error,
        )
      }
    }
  }

  console.log(`[HUMAN_SUPPORT] 🔒 Cierre masivo para config ${configId}: ${closedCount} sesión(es) cerrada(s)`)

  return { closedCount }
}

// ─── Pending Human Support Offer ────────────────────────────────────────────
// When humanSupportOfferToPatient is ON, we store the pending params in Redis
// and send the patient a choice before creating the session.

const HUMAN_SUPPORT_OFFER_PREFIX = "human_support_offer:"
const HUMAN_SUPPORT_OFFER_TTL = 60 * 60 // 1 hora

export interface HumanSupportOfferParams {
  configId: string
  tenantId: string
  threadId: string
  assistantId: string
  displayName: string
  reason: string
  priority: "low" | "medium" | "high"
  summary: string
  phoneNumberId: string
  accessToken: string
  // Etapa del flujo de oferta:
  // - "offer"  (o undefined): esperando que el paciente confirme 1/2.
  // - "reason": confirmó atención humana, ahora esperamos que elija el motivo.
  stage?: "offer" | "reason"
  // Mensaje a enviar si el paciente RECHAZA la oferta (opción 2). Cuando la oferta
  // se dispara desde una derivación al teléfono, acá va el texto con el teléfono de
  // la clínica. Si no se define, se usa el mensaje por defecto ("seguís con el asistente").
  declineMessage?: string
}

export async function setPendingHumanSupportOffer(
  configId: string,
  phoneNumber: string,
  params: HumanSupportOfferParams,
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  const key = `${HUMAN_SUPPORT_OFFER_PREFIX}${configId}:${phoneNumber}`
  await redis.set(key, JSON.stringify(params))
  await redis.expire(key, HUMAN_SUPPORT_OFFER_TTL)
  console.log(`[HUMAN_SUPPORT] 📬 Oferta pendiente guardada para ${phoneNumber}`)
}

export async function getPendingHumanSupportOffer(
  configId: string,
  phoneNumber: string,
): Promise<HumanSupportOfferParams | null> {
  const redis = getRedisClient()
  if (!redis) return null
  const key = `${HUMAN_SUPPORT_OFFER_PREFIX}${configId}:${phoneNumber}`
  const raw = await redis.get(key)
  if (!raw) return null
  try {
    return typeof raw === "string" ? JSON.parse(raw) : (raw as HumanSupportOfferParams)
  } catch {
    return null
  }
}

export async function clearPendingHumanSupportOffer(
  configId: string,
  phoneNumber: string,
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  const key = `${HUMAN_SUPPORT_OFFER_PREFIX}${configId}:${phoneNumber}`
  await redis.del(key)
}
