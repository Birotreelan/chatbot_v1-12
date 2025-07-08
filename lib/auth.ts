import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { Redis } from "@upstash/redis"
import { nanoid } from "nanoid"

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

// Verificar credenciales
export async function verifyCredentials(username: string, password: string): Promise<boolean> {
  // En un entorno de producción, deberías usar hashing para las contraseñas
  return username === ADMIN_USERNAME && password === ADMIN_PASSWORD
}

// Crear una sesión
export async function createSession(username: string): Promise<string> {
  const sessionId = nanoid()
  const redis = getRedisClient()

  if (redis) {
    // Guardar la sesión en Redis con expiración - como cadena, no como objeto
    await redis.set(`${SESSION_PREFIX}${sessionId}`, username, { ex: SESSION_DURATION })
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

// Verificar sesión
export async function getSession(): Promise<string | null> {
  const sessionId = cookies().get("session_id")?.value

  if (!sessionId) return null

  const redis = getRedisClient()

  if (redis) {
    const username = await redis.get<string>(`${SESSION_PREFIX}${sessionId}`)
    return username
  }

  return null
}

// Comprueba si existe una sesión válida y devuelve un booleano
export async function checkAuth(): Promise<boolean> {
  const session = await getSession()
  return session !== null
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

// Middleware para proteger rutas
export async function requireAuth() {
  const session = await getSession()

  if (!session) {
    redirect("/login?error=unauthenticated")
  }

  return session
}
