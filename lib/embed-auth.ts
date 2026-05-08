import { jwtVerify, SignJWT } from "jose"
import { Redis } from "@upstash/redis"
import { nanoid } from "nanoid"
import type { SessionData } from "./types"

// Secreto para firmar tokens JWT (debe configurarse en variables de entorno)
const EMBED_SECRET = process.env.SUPPORT_EMBED_SECRET || "default-secret-change-in-production"
const SECRET_KEY = new TextEncoder().encode(EMBED_SECRET)

// Prefijo para tokens usados (one-time use)
const USED_TOKEN_PREFIX = "embed_token_used:"
// Duracion del token en segundos (10 minutos)
const TOKEN_EXPIRY = 60 * 10
// Duracion de la sesion embed en segundos (8 horas)
const EMBED_SESSION_DURATION = 60 * 60 * 8
// Prefijo para sesiones embed
const EMBED_SESSION_PREFIX = "embed_session:"

// Payload del token JWT
export interface EmbedTokenPayload {
  sub: string // ID del agente
  name: string // Nombre para mostrar
  email?: string // Email del agente
  role: "support_agent" | "super_admin"
  tenantId?: string // ID del tenant/cliente
  iat?: number // Issued at
  exp?: number // Expiration
  jti?: string // JWT ID (para one-time use)
}

function getRedisClient() {
  try {
    return Redis.fromEnv()
  } catch (error) {
    console.warn("[EMBED_AUTH] Upstash Redis no disponible:", error)
    return null
  }
}

/**
 * Genera un token JWT para embeber el panel de soporte
 * Esta funcion seria llamada por el sistema externo o por una API interna
 */
export async function generateEmbedToken(payload: Omit<EmbedTokenPayload, "iat" | "exp" | "jti">): Promise<string> {
  const jti = nanoid() // ID unico para one-time use

  const token = await new SignJWT({
    ...payload,
    jti,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_EXPIRY}s`)
    .sign(SECRET_KEY)

  return token
}

/**
 * Verifica y decodifica un token JWT
 * Retorna null si el token es invalido, expirado o ya fue usado
 */
export async function verifyEmbedToken(token: string): Promise<EmbedTokenPayload | null> {
  try {
    // Verificar firma y expiracion
    const { payload } = await jwtVerify(token, SECRET_KEY)

    const tokenPayload = payload as unknown as EmbedTokenPayload

    // Verificar campos requeridos
    if (!tokenPayload.sub || !tokenPayload.name || !tokenPayload.role) {
      console.log("[EMBED_AUTH] Token invalido: campos requeridos faltantes")
      return null
    }

    // Verificar one-time use
    const redis = getRedisClient()
    if (redis && tokenPayload.jti) {
      const usedKey = `${USED_TOKEN_PREFIX}${tokenPayload.jti}`
      const alreadyUsed = await redis.get(usedKey)

      if (alreadyUsed) {
        console.log("[EMBED_AUTH] Token ya fue utilizado:", tokenPayload.jti)
        return null
      }

      // Marcar como usado (expira cuando expira el token original)
      await redis.set(usedKey, "1", { ex: TOKEN_EXPIRY })
    }

    console.log("[EMBED_AUTH] Token verificado exitosamente para:", tokenPayload.name)
    return tokenPayload

  } catch (error: any) {
    if (error.code === "ERR_JWT_EXPIRED") {
      console.log("[EMBED_AUTH] Token expirado")
    } else if (error.code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED") {
      console.log("[EMBED_AUTH] Firma de token invalida")
    } else {
      console.error("[EMBED_AUTH] Error verificando token:", error)
    }
    return null
  }
}

/**
 * Crea una sesion embed despues de verificar el token
 * Retorna el ID de sesion que se usara en las peticiones subsecuentes
 */
export async function createEmbedSession(tokenPayload: EmbedTokenPayload): Promise<string> {
  const sessionId = nanoid()
  const redis = getRedisClient()

  const sessionData: SessionData = {
    userId: tokenPayload.sub,
    username: tokenPayload.email || tokenPayload.name,
    role: tokenPayload.role,
    tenantId: tokenPayload.tenantId || null,
    displayName: tokenPayload.name,
    isEmbed: true, // Marcar como sesion embed
  }

  if (redis) {
    await redis.set(
      `${EMBED_SESSION_PREFIX}${sessionId}`,
      JSON.stringify(sessionData),
      { ex: EMBED_SESSION_DURATION }
    )
  }

  console.log("[EMBED_AUTH] Sesion embed creada:", sessionId)
  return sessionId
}

/**
 * Obtiene una sesion embed por su ID
 */
export async function getEmbedSession(sessionId: string): Promise<SessionData | null> {
  const redis = getRedisClient()
  if (!redis) return null

  try {
    const sessionData = await redis.get(`${EMBED_SESSION_PREFIX}${sessionId}`)
    if (!sessionData) return null

    if (typeof sessionData === "string") {
      return JSON.parse(sessionData)
    }

    return sessionData as SessionData
  } catch (error) {
    console.error("[EMBED_AUTH] Error obteniendo sesion embed:", error)
    return null
  }
}

/**
 * Cierra una sesion embed
 */
export async function closeEmbedSession(sessionId: string): Promise<void> {
  const redis = getRedisClient()
  if (redis) {
    await redis.del(`${EMBED_SESSION_PREFIX}${sessionId}`)
  }
}
