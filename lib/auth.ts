import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { Redis } from "@upstash/redis"
import { nanoid } from "nanoid"
import type { SessionData } from "./types"
import { verifySupportUserPassword } from "./support-users"

// Prefijo para las sesiones en Redis
const SESSION_PREFIX = "session:" as const
// Duración de la sesión en segundos (7 días)
const SESSION_DURATION = 60 * 60 * 24 * 7

// Credenciales de administrador (en producción, esto debería estar en variables de entorno)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin"
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "whatsapp123"

// Obtener el cliente de Redis
function getRedisClient() {
  try {
    console.log("[v0] Redis ENV check:", {
      hasUrl: !!process.env.UPSTASH_REDIS_REST_URL,
      urlPrefix: process.env.UPSTASH_REDIS_REST_URL?.substring(0, 30),
      hasToken: !!process.env.UPSTASH_REDIS_REST_TOKEN,
    })
    return Redis.fromEnv()
  } catch (error) {
    console.warn("Upstash Redis no está disponible:", error)
    return null
  }
}

export async function verifyCredentials(
  username: string,
  password: string,
): Promise<{ success: boolean; user?: SessionData; error?: string }> {
  console.log("[v0] verifyCredentials llamado con username:", username)
  
  // 1. Verificar si es el super admin
  console.log("[v0] Verificando super admin - ADMIN_USERNAME:", ADMIN_USERNAME)
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    console.log("[v0] Login exitoso como super_admin")
    return {
      success: true,
      user: {
        userId: "super_admin",
        username,
        role: "super_admin",
        tenantId: null,
        displayName: "Super Administrador",
      },
    }
  }

  // 2. Buscar en usuarios de soporte
  console.log("[v0] No es super admin, buscando en usuarios de soporte...")
  try {
    console.log("[v0] Llamando verifySupportUserPassword...")
    const supportUser = await verifySupportUserPassword(username, password)
    console.log("[v0] Resultado verifySupportUserPassword:", supportUser ? "usuario encontrado" : "null")

    if (!supportUser) {
      return {
        success: false,
        error: "Usuario o contraseña incorrectos",
      }
    }

    return {
      success: true,
      user: {
        userId: supportUser.id,
        username: supportUser.username,
        role: supportUser.role,
        tenantId: supportUser.tenantId,
        displayName: supportUser.displayName,
      },
    }
  } catch (error) {
    console.error("[v0] Error en verifyCredentials:", error)
    return {
      success: false,
      error: "Error al procesar la solicitud",
    }
  }
}

export async function createSession(user: SessionData): Promise<string> {
  const sessionId = nanoid()
  const redis = getRedisClient()

  if (redis) {
    // Guardar la sesión completa en Redis con expiración
    await redis.set(`${SESSION_PREFIX}${sessionId}`, JSON.stringify(user), { ex: SESSION_DURATION })
  }

  // Establecer la cookie de sesión
  // SameSite=None + Secure es necesario para que funcione dentro de iframes de terceros
  const cookieStore = await cookies()
  cookieStore.set("session_id", sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: SESSION_DURATION,
    path: "/",
  })

  return sessionId
}

/**
 * Crea una sesión sin establecer la cookie (para usar en API routes con redirect)
 * Retorna el sessionId para que el caller pueda establecer la cookie manualmente
 */
export async function createSessionWithoutCookie(user: SessionData): Promise<string> {
  const sessionId = nanoid()
  const redis = getRedisClient()

  if (redis) {
    // Guardar la sesión completa en Redis con expiración
    await redis.set(`${SESSION_PREFIX}${sessionId}`, JSON.stringify(user), { ex: SESSION_DURATION })
    console.log("[Auth] Sesión creada en Redis:", sessionId)
  }

  return sessionId
}

/**
 * Constantes de sesión exportadas para uso en API routes
 */
export const SESSION_COOKIE_NAME = "session_id"
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "none" as const,
  maxAge: SESSION_DURATION,
  path: "/",
}

export async function getSession(): Promise<SessionData | null> {
  const cookieStore = await cookies()
  let sessionId = cookieStore.get("session_id")?.value
  
  // Fallback para Safari: leer session ID desde header (establecido por middleware desde _sid)
  if (!sessionId) {
    const headerStore = await headers()
    sessionId = headerStore.get("x-session-id") || undefined
    if (sessionId) {
      console.log("[Auth] Session ID obtenido desde header x-session-id (Safari fallback)")
    }
  }
  
  if (!sessionId) return null

  const redis = getRedisClient()
  if (redis) {
    try {
      const sessionData = await redis.get(`${SESSION_PREFIX}${sessionId}`)
      if (!sessionData) return null

      if (typeof sessionData === "string") {
        // Si es solo "admin" (formato antiguo), convertir al nuevo formato
        if (sessionData === "admin") {
          const newSessionData: SessionData = {
            userId: "super_admin",
            username: ADMIN_USERNAME,
            role: "super_admin",
            tenantId: null,
            displayName: "Super Administrador",
          }
          // Actualizar en Redis con el nuevo formato
          await redis.set(`${SESSION_PREFIX}${sessionId}`, JSON.stringify(newSessionData), {
            ex: SESSION_DURATION,
          })
          return newSessionData
        }

        // Intentar parsear como JSON
        try {
          return JSON.parse(sessionData)
        } catch (parseError) {
          console.error("[Auth] Error parsing session data:", parseError)
          // Si no se puede parsear, eliminar la sesión corrupta
          await redis.del(`${SESSION_PREFIX}${sessionId}`)
          cookieStore.delete("session_id")
          return null
        }
      }

      return sessionData as SessionData
    } catch (error) {
      console.error("[Auth] Error getting session:", error)
      return null
    }
  }

  return null
}

// Cerrar sesión
export async function logout(): Promise<void> {
  const cookieStore = await cookies()
  const sessionId = cookieStore.get("session_id")?.value
  if (sessionId) {
    const redis = getRedisClient()
    if (redis) {
      await redis.del(`${SESSION_PREFIX}${sessionId}`)
    }
    cookieStore.delete("session_id")
  }
}

export async function requireAuth(): Promise<SessionData> {
  const session = await getSession()
  if (!session) {
    redirect("/login?error=unauthenticated")
  }
  return session
}

// Version para API routes - no hace redirect, retorna null si no hay sesion
export async function getSessionForApi(): Promise<SessionData | null> {
  return await getSession()
}

/**
 * Obtiene la sesión desde un Request object.
 * Intenta múltiples fuentes para soportar Safari en iframes donde las cookies no funcionan:
 * 1. Cookie session_id (funciona en Chrome/Firefox)
 * 2. Header X-Session-Id (enviado por el cliente en fetch)
 * 3. Query param _sid (pasado en la URL)
 */
export async function getSessionFromRequest(request: Request): Promise<SessionData | null> {
  const redis = getRedisClient()
  if (!redis) return null

  let sessionId: string | null = null
  
  // 1. Intentar obtener de la cookie (método estándar)
  const cookieHeader = request.headers.get("cookie")
  if (cookieHeader) {
    const cookies = cookieHeader.split(";").map(c => c.trim())
    for (const cookie of cookies) {
      if (cookie.startsWith("session_id=")) {
        sessionId = cookie.substring("session_id=".length)
        console.log("[Auth] Session ID obtenido de cookie:", sessionId?.substring(0, 8) + "...")
        break
      }
    }
  }
  
  // 2. Si no hay cookie, intentar desde el header X-Session-Id (Safari fallback)
  if (!sessionId) {
    sessionId = request.headers.get("x-session-id")
    if (sessionId) {
      console.log("[Auth] Session ID obtenido de header X-Session-Id (Safari fallback):", sessionId.substring(0, 8) + "...")
    }
  }
  
  // 3. Si no hay header, intentar desde query param _sid (Safari fallback)
  if (!sessionId) {
    const url = new URL(request.url)
    sessionId = url.searchParams.get("_sid")
    if (sessionId) {
      console.log("[Auth] Session ID obtenido de query param _sid (Safari fallback):", sessionId.substring(0, 8) + "...")
    }
  }
  
  if (!sessionId) {
    console.log("[Auth] No se encontró session ID en ninguna fuente")
    return null
  }

  try {
    const sessionData = await redis.get(`${SESSION_PREFIX}${sessionId}`)
    if (!sessionData) {
      console.log("[Auth] Session ID válido pero no encontrado en Redis:", sessionId.substring(0, 8) + "...")
      return null
    }

    if (typeof sessionData === "string") {
      try {
        return JSON.parse(sessionData)
      } catch (parseError) {
        console.error("[Auth] Error parsing session data:", parseError)
        return null
      }
    }

    return sessionData as SessionData
  } catch (error) {
    console.error("[Auth] Error getting session from Redis:", error)
    return null
  }
}

// Versiones para API routes que retornan { session, error } en lugar de hacer redirect
export async function requireAuthForApi(): Promise<{ session: SessionData | null; error?: string }> {
  const session = await getSession()
  if (!session) {
    return { session: null, error: "No autenticado" }
  }
  return { session }
}

/**
 * Versión de requireAuthForApi que lee desde Request (para Safari/iframe support)
 */
export async function requireAuthFromRequest(request: Request): Promise<{ session: SessionData | null; error?: string }> {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return { session: null, error: "No autenticado" }
  }
  return { session }
}

export async function requireSupportAgentForApi(): Promise<{ session: SessionData | null; error?: string }> {
  const session = await getSession()
  if (!session) {
    return { session: null, error: "No autenticado" }
  }
  if (session.role !== "support_agent") {
    return { session: null, error: "No autorizado - se requiere rol de agente de soporte" }
  }
  return { session }
}

/**
 * Versión de requireSupportAgentForApi que lee desde Request (para Safari/iframe support)
 */
export async function requireSupportAgentFromRequest(request: Request): Promise<{ session: SessionData | null; error?: string }> {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return { session: null, error: "No autenticado" }
  }
  if (session.role !== "support_agent") {
    return { session: null, error: "No autorizado - se requiere rol de agente de soporte" }
  }
  return { session }
}

export async function requireSuperAdmin(): Promise<SessionData> {
  const session = await getSession()
  if (!session) {
    redirect("/login?error=unauthenticated")
  }
  if (session.role !== "super_admin") {
    redirect("/support")
  }
  return session
}

export async function requireSupportAgent(): Promise<SessionData> {
  const session = await getSession()
  if (!session) {
    redirect("/login?error=unauthenticated")
  }
  if (session.role !== "support_agent") {
    redirect("/dashboard")
  }
  return session
}
