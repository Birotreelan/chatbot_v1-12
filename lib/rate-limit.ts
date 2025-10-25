import { Redis } from "@upstash/redis"
import { incrementMetric } from "./monitoring"

// Lista de IPs de Meta/WhatsApp que deben estar exentas del rate limiting
const META_WHATSAPP_IPS = [
  "173.252.107.",
  "173.252.127.",
  "173.252.110.",
  "31.13.127.",
  "31.13.115.",
  "31.13.83.",
  "31.13.84.",
  "31.13.85.",
  "31.13.86.",
  "31.13.87.",
  "31.13.88.",
  "31.13.89.",
  "31.13.90.",
  "31.13.91.",
  "31.13.92.",
  "31.13.93.",
  "31.13.94.",
  "31.13.95.",
  "69.171.250.",
  "69.171.251.",
  "69.171.252.",
  "69.171.253.",
  "69.171.254.",
  "69.171.255.",
  "66.220.144.",
  "66.220.145.",
  "66.220.146.",
  "66.220.147.",
  "66.220.148.",
  "66.220.149.",
  "66.220.150.",
  "66.220.151.",
  "66.220.152.",
  "66.220.153.",
  "66.220.154.",
  "66.220.155.",
  "66.220.156.",
  "66.220.157.",
  "66.220.158.",
  "66.220.159.",
]

// Función para verificar si una IP pertenece a Meta/WhatsApp
function isMetaWhatsAppIP(ip: string): boolean {
  return META_WHATSAPP_IPS.some((prefix) => ip.startsWith(prefix))
}

// Función para limitar la tasa de solicitudes
export async function rateLimit(
  key: string,
  maxRequests: number = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 20),
  window: number = Number(process.env.RATE_LIMIT_WINDOW || 300000), // 5 minutos (antes 60000)
  globalMax: number = Number(process.env.RATE_LIMIT_GLOBAL_MAX || 1000),
): Promise<{ success: boolean; current: number; limit: number; reset: number }> {
  try {
    // Si la IP pertenece a Meta/WhatsApp, permitir siempre
    if (key.startsWith("ip:") && isMetaWhatsAppIP(key.substring(3))) {
      return {
        success: true,
        current: 0,
        limit: maxRequests,
        reset: Date.now() + window,
      }
    }

    const redis = Redis.fromEnv()
    const now = Date.now()
    const windowKey = `${key}:${Math.floor(now / window)}`
    const globalKey = "global:requests"

    // Incrementar contador para esta clave y ventana
    const count = await redis.incr(windowKey)

    // Establecer TTL si es la primera solicitud en esta ventana
    if (count === 1) {
      await redis.expire(windowKey, Math.ceil(window / 1000))
    }

    // Incrementar contador global
    const globalCount = await redis.incr(globalKey)

    // Establecer TTL para el contador global si es la primera solicitud
    if (globalCount === 1) {
      await redis.expire(globalKey, 60) // 1 minuto
    }

    // Verificar límite global
    if (globalCount > globalMax) {
      await incrementMetric("global_rate_limited")
      return {
        success: false,
        current: globalCount,
        limit: globalMax,
        reset: now + 60000, // 1 minuto
      }
    }

    // Verificar límite específico
    const success = count <= maxRequests
    if (!success) {
      await incrementMetric("rate_limited")
    }

    return {
      success,
      current: count,
      limit: maxRequests,
      reset: now + window,
    }
  } catch (error) {
    console.error("Error en rate limiting:", error)
    // En caso de error, permitir la solicitud
    return {
      success: true,
      current: 0,
      limit: maxRequests,
      reset: Date.now() + window,
    }
  }
}
