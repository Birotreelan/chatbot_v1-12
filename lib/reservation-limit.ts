import { Redis } from "@upstash/redis"

/**
 * Tope de RESERVAS COMPLETADAS (no de mensajes) por IP, para evitar que una
 * persona o un bot llene la agenda de una clínica reservando turno tras
 * turno desde el widget público. Es una ventana deslizante por día, no un
 * bloqueo permanente: las IPs se comparten (NAT de operadores móviles,
 * wifis compartidas, oficinas), así que un corte de por vida terminaría
 * bloqueando pacientes legítimos que nunca hicieron nada.
 *
 * Se complementa con el rate limiting general y el específico de DNI
 * (lib/rate-limit.ts, lib/dni-rate-limit.ts), que limitan la velocidad de
 * mensajes; esto limita el resultado final (turnos efectivamente reservados).
 */
const MAX_RESERVAS_POR_IP = 3
const WINDOW_MS = 24 * 60 * 60 * 1000 // 24hs

function getRedisClient() {
  try {
    return Redis.fromEnv()
  } catch (error) {
    console.error("[reservation-limit] Error creando Redis client:", error)
    return null
  }
}

function windowKey(ip: string): string {
  const bucket = Math.floor(Date.now() / WINDOW_MS)
  return `reservation-limit:ip:${ip}:${bucket}`
}

/** Consulta si esta IP ya alcanzó el máximo de reservas de hoy, SIN incrementar el contador. */
export async function hasReachedReservationLimit(ip: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false // si Redis no está disponible, no bloqueamos (igual que rate-limit.ts)

  try {
    const count = await redis.get<number>(windowKey(ip))
    return (count || 0) >= MAX_RESERVAS_POR_IP
  } catch (error) {
    console.error("[reservation-limit] Error consultando límite:", error)
    return false
  }
}

/** Registra una reserva completada desde esta IP (llamar SOLO cuando la reserva fue exitosa). */
export async function recordReservation(ip: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  try {
    const key = windowKey(ip)
    const count = await redis.incr(key)
    if (count === 1) {
      await redis.expire(key, Math.ceil(WINDOW_MS / 1000))
    }
  } catch (error) {
    console.error("[reservation-limit] Error registrando reserva:", error)
  }
}

export const RESERVATION_LIMIT_MESSAGE =
  "Alcanzaste el máximo de solicitudes de turno permitidas por hoy desde esta conexión. Si necesitás ayuda, contactate directamente con la clínica."
