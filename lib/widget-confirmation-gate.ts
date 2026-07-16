import { Redis } from "@upstash/redis"

/**
 * Marca, del lado del servidor, cuándo una sesión de widget está parada
 * justo en el paso de confirmación de reserva — el único punto donde exigimos
 * pasar el CAPTCHA (Turnstile) antes de dejar avanzar el mensaje.
 *
 * Por qué esto y no confiar en lo que manda el frontend: si sólo
 * verificáramos el token cuando el cliente dice "acá va uno", un script que
 * hable directo con la API (sin renderizar el widget) simplemente no manda
 * token y listo. Guardando la marca en el servidor, en base al step que
 * REALMENTE le mandamos a ese session_id, la verificación no se puede saltear
 * desde el cliente.
 */
const PREFIX = "widget-awaiting-confirmation:"
const TTL_SECONDS = 15 * 60 // 15 min — tiempo generoso para completar el CAPTCHA

function getRedisClient() {
  try {
    return Redis.fromEnv()
  } catch (error) {
    console.error("[widget-confirmation-gate] Error creando Redis client:", error)
    return null
  }
}

export async function markAwaitingConfirmation(sessionId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  try {
    await redis.set(`${PREFIX}${sessionId}`, "1", { ex: TTL_SECONDS })
  } catch (error) {
    console.error("[widget-confirmation-gate] Error marcando sesión:", error)
  }
}

export async function isAwaitingConfirmation(sessionId: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false
  try {
    const value = await redis.get(`${PREFIX}${sessionId}`)
    return value === "1"
  } catch (error) {
    console.error("[widget-confirmation-gate] Error consultando sesión:", error)
    return false
  }
}

export async function clearAwaitingConfirmation(sessionId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  try {
    await redis.del(`${PREFIX}${sessionId}`)
  } catch (error) {
    console.error("[widget-confirmation-gate] Error limpiando sesión:", error)
  }
}
