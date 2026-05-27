/**
 * Sprint 3: Despedidas Anti-Repetición
 * 
 * Detecta despedidas múltiples y evita que OpenAI repita la misma despedida
 * Implementa MODO A (cierre completo) vs MODO B (cierre breve)
 * 
 * Lógica determinística que reduce carga en OpenAI
 */

import { createConversationLogger } from "./conversation-state/logger"
import { getRedisClient } from "./redis"

const FAREWELL_KEYWORDS = [
  "gracias",
  "muchas gracias", 
  "mil gracias",
  "ok",
  "listo",
  "dale",
  "perfecto",
  "bueno",
  "buenísimo",
  "un gusto",
  "hasta luego",
  "chau",
  "adiós",
]

const FAREWELL_MODE_A_TEMPLATES = [
  "Si necesitás algo más, no dudes en escribirme.",
  "Cualquier cosa, no dudes en comunicarte.",
  "Estoy acá si necesitás algo más.",
]

const FAREWELL_MODE_B_TEMPLATES = [
  "¡A vos!",
  "¡Un gusto!",
  "¡Listo!",
  "¡Cualquier cosa por acá estoy!",
  "¡Nos vemos!",
  "¡Perfecto!",
]

export interface FarewellState {
  farewell_sent: boolean
  farewell_sent_at: string
  last_farewell_mode: "A" | "B"
}

/**
 * Detecta si el mensaje es una despedida
 */
export function isFarewellMessage(message: string): boolean {
  const lowerMessage = message.toLowerCase().trim()
  return FAREWELL_KEYWORDS.some((keyword) =>
    lowerMessage.includes(keyword)
  )
}

/**
 * Obtiene el estado de despedida de Redis
 */
async function getFarewellState(
  userPhone: string,
  configId: string
): Promise<FarewellState | null> {
  const redis = getRedisClient()
  if (!redis) return null

  try {
    const key = `farewell:${configId}:${userPhone}`
    const data = await redis.get(key)
    if (!data) return null

    return JSON.parse(data as string) as FarewellState
  } catch (error) {
    console.error("[FAREWELL] Error leyendo estado de despedida:", error)
    return null
  }
}

/**
 * Guarda el estado de despedida en Redis (TTL 1 hora)
 */
async function setFarewellState(
  userPhone: string,
  configId: string,
  state: FarewellState
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  try {
    const key = `farewell:${configId}:${userPhone}`
    const ttlSeconds = 3600 // 1 hora
    await redis.setex(key, ttlSeconds, JSON.stringify(state))
  } catch (error) {
    console.error("[FAREWELL] Error guardando estado de despedida:", error)
  }
}

/**
 * Limpia el estado de despedida
 */
async function clearFarewellState(
  userPhone: string,
  configId: string
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  try {
    const key = `farewell:${configId}:${userPhone}`
    await redis.del(key)
  } catch (error) {
    console.error("[FAREWELL] Error limpiando estado de despedida:", error)
  }
}

/**
 * Selecciona una plantilla aleatoria del banco correspondiente
 */
function selectFarewellTemplate(mode: "A" | "B"): string {
  const templates = mode === "A" ? FAREWELL_MODE_A_TEMPLATES : FAREWELL_MODE_B_TEMPLATES
  return templates[Math.floor(Math.random() * templates.length)]
}

/**
 * Obtiene el saludo de despedida según la hora del día
 */
function getTimeBasedGreeting(): string {
  const hour = new Date().getHours()
  
  if (hour >= 5 && hour < 12) {
    return "¡Que tengas un excelente día!"
  } else if (hour >= 12 && hour < 18) {
    return "¡Que disfrutes la tarde!"
  } else if (hour >= 18 && hour < 22) {
    return "¡Que tengas buena noche!"
  } else {
    return "¡Que descanses!"
  }
}

/**
 * Maneja despedidas detectadas
 * Retorna:
 * - null: no es despedida, continuar a OpenAI
 * - string: mensaje de despedida directo, NO pasar a OpenAI
 */
export async function handleFarewellIfDetected(
  message: string,
  userPhone: string,
  configId: string,
  patientName: string
): Promise<string | null> {
  const logger = createConversationLogger(userPhone, configId, "farewell")

  // Verificar si es mensaje de despedida
  if (!isFarewellMessage(message)) {
    return null
  }

  logger.info("Mensaje de despedida detectado", { message })

  // Obtener estado actual
  const currentState = await getFarewellState(userPhone, configId)

  if (!currentState || !currentState.farewell_sent) {
    // MODO A: Primera despedida (cierre completo)
    logger.info("Primera despedida - usando MODO A (cierre completo)")

    const template = selectFarewellTemplate("A")
    const timeGreeting = getTimeBasedGreeting()
    const farewellResponse = `¡${patientName}! ${template} ${timeGreeting}`

    // Marcar despedida como enviada
    await setFarewellState(userPhone, configId, {
      farewell_sent: true,
      farewell_sent_at: new Date().toISOString(),
      last_farewell_mode: "A",
    })

    logger.info("Despedida MODO A enviada", {
      response: farewellResponse,
    })

    return farewellResponse
  } else {
    // MODO B: Despedida posterior (cierre breve)
    logger.info("Despedida posterior - usando MODO B (cierre breve)")

    const template = selectFarewellTemplate("B")
    const farewellResponse = `¡${template}!`

    // No actualizar el estado, mantener farewell_sent = true

    logger.info("Despedida MODO B enviada", {
      response: farewellResponse,
    })

    return farewellResponse
  }
}

/**
 * Exporta funciones para testing/debugging
 */
export const FarewellDebug = {
  getFarewellState,
  setFarewellState,
  clearFarewellState,
  getTimeBasedGreeting,
  selectFarewellTemplate,
  isFarewellMessage,
}
