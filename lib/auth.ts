import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { Redis } from "@upstash/redis"
import { nanoid } from "nanoid"
import type { SessionData } from "./types"
import { verifySupportUserPassword } from "./support-users"

// Prefijo para las sesiones en Redis
const SESSION_PREFIX = "session:"
// Duración de la sesión en segundos (7 días)
const SESSION_DURATION = 60 * 60 * 24 * 7

// Credenciales de administrador (en producción, esto debería estar en variables de entorno)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin"
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "whatsapp123"

// Obtener el cliente de Redis
function getRedisClient() {
  try {
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
  // 1. Verificar si es el super admin
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
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
  try {
    const supportUser = await verifySupportUserPassword(username, password)

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
    console.error("[Auth] Error verificando credenciales:", error)
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
  cookies().set("session_id", sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DURATION,
    path: "/",
  })

  return sessionId
}

export async function getSession(): Promise<SessionData | null> {
  const sessionId = cookies().get("session_id")?.value

  if (!sessionId) return null

  const redis = getRedisClient()

  if (redis) {
    const sessionData = await redis.get(`${SESSION_PREFIX}${sessionId}`)

    if (!sessionData) return null

    if (typeof sessionData === "string") {
      return JSON.parse(sessionData)
    }
    return sessionData as SessionData
  }

  return null
}

// Cerrar sesión
export async function logout(): Promise<void> {
  const sessionId = cookies().get("session_id")?.value

  if (sessionId) {
    const redis = getRedisClient()

    if (redis) {
      await redis.del(`${SESSION_PREFIX}${sessionId}`)
    }

    cookies().delete("session_id")
  }
}

export async function requireAuth(): Promise<SessionData> {
  const session = await getSession()

  if (!session) {
    redirect("/login?error=unauthenticated")
  }

  return session
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
