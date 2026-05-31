/**
 * Sprint 13: Deteccion de Numero Equivocado
 * 
 * Detecta cuando el usuario indica que el recordatorio no es para el/ella.
 * Esto ocurre cuando el sistema envia un recordatorio a un numero que ya no
 * pertenece al paciente registrado.
 * 
 * Patrones detectados:
 * - "Se equivocaron de numero"
 * - "No soy esa persona"
 * - "Numero equivocado"
 * - "No es para mi"
 * - "No me llamo asi"
 * etc.
 */

import { createConversationLogger } from "./logger"
import { getRedisClient } from "@/lib/redis"
import { getArgentinaHour } from "@/lib/utils/date-utils"

// Patrones que indican CLARAMENTE que el usuario NO es la persona del recordatorio
// Estos son casos 100% seguros que no necesitan NLU
const WRONG_NUMBER_PATTERNS = [
  // Numero equivocado - variantes
  /(?:se\s+)?equivoc(?:aron|aste|ó|o)\s+(?:de\s+)?n[uú]mero/i,
  /n[uú]mero\s+equivocado/i,
  /tienen\s+(?:el\s+)?n[uú]mero\s+equivocado/i,
  /no\s+es\s+(?:mi|este)\s+n[uú]mero/i,
  /(?:creo\s+que\s+)?(?:te|se)\s+equivocaste/i,
  /(?:creo\s+que\s+)?se\s+(?:han\s+)?equivocado/i,
  /(?:creo\s+que\s+)?(?:es|hay)\s+(?:un\s+)?error/i,
  /mensaje\s+(?:no\s+)?(?:es\s+)?para\s+(?:otra|otro)\s+persona/i,
  
  // No soy esa persona - variantes extendidas
  /no\s+soy\s+(?:la\s+)?(?:esa\s+)?persona/i,
  /no\s+soy\s+(?:el|ella|esa?|ese|yo)/i,
  /no\s+soy\s+quien\s+buscan/i,
  /no\s+soy\s+(?:el|la)\s+(?:paciente|persona)/i,
  /(?:esa|ese)\s+(?:no\s+)?soy\s+yo/i,
  /yo\s+no\s+soy\s+(?:esa|ese|el|la)/i,
  /no\s+soy\s+[A-Z][a-záéíóú]+/i, // "no soy Maria", "no soy Juan"
  
  // No es para mi / mi turno - variantes
  /no\s+es\s+(?:para\s+)?m[ií]/i,
  /(?:ese|este|el)\s+turno\s+no\s+es\s+(?:para\s+)?m[ií]o?/i,
  /no\s+es\s+mi\s+turno/i,
  /no\s+tengo\s+(?:ning[uú]n\s+)?turno/i,
  /yo\s+no\s+tengo\s+turno/i,
  /no\s+tengo\s+(?:ninguna\s+)?cita/i,
  /no\s+tengo\s+nada\s+(?:agendado|pendiente)/i,
  /no\s+(?:hice|saque|tengo)\s+(?:ninguna\s+)?(?:cita|reserva)/i,
  
  // No me llamo asi - variantes
  /no\s+me\s+llamo\s+(?:as[ií]|eso)/i,
  /(?:ese|este)\s+no\s+es\s+mi\s+nombre/i,
  /no\s+es\s+mi\s+nombre/i,
  /mi\s+nombre\s+no\s+es/i,
  /no\s+me\s+llamo\s+[A-Z][a-záéíóú]+/i, // "no me llamo Maria"
  
  // No conozco a esa persona - variantes
  /no\s+(?:lo|la)\s+conozco/i,
  /no\s+s[eé]\s+qui[eé]n\s+es/i,
  /no\s+conozco\s+(?:a\s+)?(?:esa|ninguna|esa)\s+persona/i,
  /no\s+conozco\s+(?:a\s+)?[A-Z][a-záéíóú]+/i, // "no conozco a Maria"
  /qui[eé]n\s+es\s+(?:esa|ese)\s+(?:persona|paciente)/i,
  /no\s+tengo\s+idea\s+(?:de\s+)?qui[eé]n/i,
  
  // No soy paciente - variantes
  /no\s+soy\s+paciente/i,
  /no\s+soy\s+(?:de\s+)?(?:la\s+)?cl[ií]nica/i,
  /nunca\s+fui\s+(?:a\s+)?(?:esa\s+)?cl[ií]nica/i,
  /no\s+(?:soy|fui)\s+(?:paciente\s+)?(?:de\s+)?(?:ah[ií]|all[ií]|ustedes)/i,
  /nunca\s+(?:he\s+)?(?:ido|asistido|consultado)/i,
  /no\s+(?:atiendo|me\s+atiendo)\s+(?:en\s+)?(?:esa|ahi)/i,
  
  // Familiar/tercero que responde
  /(?:ya\s+)?no\s+(?:tiene|usa)\s+este\s+n[uú]mero/i,
  /(?:el|ella|esa\s+persona)\s+ya\s+no\s+(?:tiene|usa)/i,
  /este\s+(?:cel|celular|telefono|n[uú]mero)\s+(?:ya\s+)?no\s+(?:es|pertenece)/i,
  /cambio\s+(?:de\s+)?n[uú]mero/i,
  /(?:el|la)\s+(?:due[nñ]o|due[nñ]a)\s+(?:anterior|de\s+antes)/i,
  
  // Confusiones explicitas
  /(?:creo\s+que\s+)?(?:se\s+)?confundieron/i,
  /(?:debe\s+)?(?:ser|haber)\s+(?:un\s+)?(?:error|confusi[oó]n)/i,
  /(?:esto\s+)?no\s+(?:es|va)\s+(?:para\s+)?(?:m[ií]|ac[aá])/i,
  /(?:le\s+)?(?:escribieron|mandaron)\s+(?:al\s+)?(?:n[uú]mero\s+)?equivocado/i,
]

// Keywords que sugieren numero equivocado (para casos menos claros)
// Se usan solo cuando hay recordatorio reciente para evitar falsos positivos
const WRONG_NUMBER_KEYWORDS = [
  "equivocado",
  "equivocaron",
  "equivocaste",
  "equivoco",
  "equivocó",
  "no soy",
  "no es para mi",
  "no me llamo",
  "no conozco",
  "numero incorrecto",
  "persona incorrecta",
  "no tengo turno",
  "no soy paciente",
  "confundieron",
  "confusión",
  "confusion",
  "error",
  "quien es",
  "no tengo cita",
  "cambio de numero",
  "ya no tiene este",
  "no pertenece",
]

/**
 * Detecta si el mensaje indica claramente que es el numero equivocado
 */
export function isWrongNumberPattern(message: string): boolean {
  const cleanMessage = message.trim()
  return WRONG_NUMBER_PATTERNS.some((pattern) => pattern.test(cleanMessage))
}

/**
 * Detecta si el mensaje PODRIA indicar numero equivocado (contiene keywords)
 * pero no coincide con patrones claros
 */
export function mightBeWrongNumber(message: string): boolean {
  const lowerMessage = message.toLowerCase().trim()
  return WRONG_NUMBER_KEYWORDS.some((keyword) => lowerMessage.includes(keyword))
}

/**
 * Obtiene el saludo de despedida segun la hora del dia en Argentina
 */
function getTimeBasedGreeting(): string {
  const hour = getArgentinaHour()
  
  if (hour >= 5 && hour < 12) {
    return "Que tengas un buen dia!"
  } else if (hour >= 12 && hour < 18) {
    return "Que tengas buena tarde!"
  } else if (hour >= 18 && hour < 22) {
    return "Que tengas buena noche!"
  } else {
    return "Que descanses!"
  }
}

/**
 * Construye la respuesta de disculpa para numero equivocado
 * Siguiendo el template del asst_router
 */
function buildWrongNumberResponse(): string {
  const timeGreeting = getTimeBasedGreeting()
  
  return `Disculpa la molestia. Parece que el recordatorio fue dirigido a un numero equivocado. Vamos a revisar nuestros registros para evitar contactarte nuevamente por este turno.

Si necesitas gestionar un turno propio en otro momento, podes escribirnos por este mismo canal indicando tu DNI y con gusto te ayudamos.

${timeGreeting}`
}

/**
 * Guarda el estado de "persona equivocada" en Redis
 * Esto previene que el sistema siga tratando al usuario como el paciente del recordatorio
 */
export async function setWrongPersonState(
  userPhone: string,
  configId: string
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  try {
    const key = `wrong_person:${configId}:${userPhone}`
    const ttlSeconds = 86400 // 24 horas
    await redis.setex(key, ttlSeconds, JSON.stringify({
      marked_at: new Date().toISOString(),
      reason: "user_indicated_wrong_number"
    }))
  } catch (error) {
    console.error("[WRONG-NUMBER] Error guardando estado de persona equivocada:", error)
  }
}

/**
 * Verifica si el usuario ya fue marcado como persona equivocada
 */
export async function isMarkedAsWrongPerson(
  userPhone: string,
  configId: string
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false

  try {
    const key = `wrong_person:${configId}:${userPhone}`
    const data = await redis.get(key)
    return data !== null
  } catch (error) {
    console.error("[WRONG-NUMBER] Error verificando estado de persona equivocada:", error)
    return false
  }
}

/**
 * Limpia el estado de persona equivocada
 * (se usaria si el usuario luego proporciona su DNI propio)
 */
export async function clearWrongPersonState(
  userPhone: string,
  configId: string
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  try {
    const key = `wrong_person:${configId}:${userPhone}`
    await redis.del(key)
  } catch (error) {
    console.error("[WRONG-NUMBER] Error limpiando estado de persona equivocada:", error)
  }
}

export interface WrongNumberDetectionResult {
  isWrongNumber: boolean
  response?: string
  confidence: "high" | "medium" | "low"
}

/**
 * Detecta si el mensaje indica numero equivocado y genera respuesta
 * 
 * @param message - Mensaje del usuario
 * @param userPhone - Telefono del usuario
 * @param configId - ID de configuracion
 * @param hasRecentReminder - Si hubo un recordatorio reciente (ultimas 24h)
 * 
 * @returns Resultado de la deteccion con respuesta si aplica
 */
export async function detectWrongNumberPreFlow(
  message: string,
  userPhone: string,
  configId: string,
  hasRecentReminder: boolean = false
): Promise<WrongNumberDetectionResult> {
  const logger = createConversationLogger(userPhone, configId, "wrong-number")

  // Paso 1: Verificar patron claro (alta confianza)
  if (isWrongNumberPattern(message)) {
    logger.info("Numero equivocado detectado por patron", { message })
    
    // Marcar usuario como "persona equivocada"
    await setWrongPersonState(userPhone, configId)
    
    const response = buildWrongNumberResponse()
    return { 
      isWrongNumber: true, 
      response,
      confidence: "high"
    }
  }

  // Paso 2: Si contiene keywords pero no coincide con patron claro
  // Solo considerarlo si hubo recordatorio reciente
  if (hasRecentReminder && mightBeWrongNumber(message)) {
    // Para casos ambiguos, ser conservador y no asumir numero equivocado
    // El sistema original usaria OpenAI para este caso
    logger.info("Posible numero equivocado pero ambiguo, dejando pasar a OpenAI", { message })
    return {
      isWrongNumber: false,
      confidence: "low"
    }
  }

  return { 
    isWrongNumber: false,
    confidence: "low"
  }
}

/**
 * Exporta funciones para testing/debugging
 */
export const WrongNumberDebug = {
  isWrongNumberPattern,
  mightBeWrongNumber,
  buildWrongNumberResponse,
  setWrongPersonState,
  isMarkedAsWrongPerson,
  clearWrongPersonState,
  getTimeBasedGreeting,
}
