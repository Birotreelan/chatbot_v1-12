/**
 * Sprint 5: Extracción y Validación de DNI
 *
 * Implementa la "REGLA UNIVERSAL: EXTRACCIÓN Y NORMALIZACIÓN DE DNI" del system prompt
 * en el backend, con lógica determinística idéntica a la que antes hacía OpenAI.
 *
 * Cuando el estado es "awaiting_dni", el backend:
 * 1. Extrae el DNI del mensaje (robusto, tolerante a formatos variados)
 * 2. Valida que tenga 7 u 8 dígitos
 * 3. Si es válido → responde directamente y continúa el flujo
 * 4. Si no es válido → responde con mensaje de error predefinido (sin OpenAI)
 */

import { createConversationLogger } from "./logger"
import { getRedisClient } from "@/lib/redis"

const DNI_STATE_PREFIX = "dni_awaiting:"
const TTL_SECONDS = 30 * 60 // 30 minutos

export interface DNIAwaitingState {
  reason: "recordatorio" | "nueva_consulta" | "paciente_nuevo" | "paciente_existente"
  attempts: number
  createdAt: string
  contextData?: Record<string, unknown>
}

/**
 * Guardar el estado "esperando DNI" en Redis
 * Se activa desde el backend cuando sabemos que necesitamos el DNI
 */
export async function saveDNIAwaitingState(
  phone: string,
  configId: string,
  reason: DNIAwaitingState["reason"],
  contextData?: Record<string, unknown>
): Promise<void> {
  const logger = createConversationLogger(phone, configId, "awaiting_dni")
  try {
    const redis = getRedisClient()
    if (!redis) {
      logger.warn("Redis no disponible para guardar estado DNI")
      return
    }

    const key = `${DNI_STATE_PREFIX}${configId}:${phone}`
    const state: DNIAwaitingState = {
      reason,
      attempts: 0,
      createdAt: new Date().toISOString(),
      contextData,
    }

    await redis.setex(key, TTL_SECONDS, JSON.stringify(state))
    logger.info("Estado awaiting_dni guardado", { reason })
  } catch (error) {
    logger.error("Error guardando estado awaiting_dni", error as Error)
  }
}

/**
 * Obtener el estado "esperando DNI"
 */
export async function getDNIAwaitingState(
  phone: string,
  configId: string
): Promise<DNIAwaitingState | null> {
  try {
    const redis = getRedisClient()
    if (!redis) return null

    const key = `${DNI_STATE_PREFIX}${configId}:${phone}`
    const data = await redis.get(key)
    if (!data) return null

    return JSON.parse(data as string) as DNIAwaitingState
  } catch (error) {
    console.error(`[DNI-HANDLER] Error obteniendo estado para ${phone}:`, error)
    return null
  }
}

/**
 * Limpiar el estado "esperando DNI"
 */
export async function clearDNIAwaitingState(
  phone: string,
  configId: string
): Promise<void> {
  try {
    const redis = getRedisClient()
    if (!redis) return
    const key = `${DNI_STATE_PREFIX}${configId}:${phone}`
    await redis.del(key)
  } catch (error) {
    console.error(`[DNI-HANDLER] Error limpiando estado para ${phone}:`, error)
  }
}

/**
 * Resultado de la extracción de DNI
 */
export type DNIExtractionResult =
  | { valid: true; dni: string; raw: string }
  | { valid: false; reason: "no_digits" | "too_short" | "too_long" | "ambiguous" }

/**
 * Extrae y normaliza un DNI de un mensaje de usuario.
 * Implementa exactamente la "REGLA UNIVERSAL" del system prompt:
 *
 * 1. Eliminar todo lo que no sea dígitos
 * 2. Verificar que queden 7 u 8 dígitos exactos
 * 3. Si hay múltiples grupos, tomar la secuencia contigua de 7-8 dígitos más larga
 *
 * Acepta:
 * - "13287031", "DNI 13287031", "Mi DNI es 13.287.031", "13 287 031"
 * - "dni: 13287031", "Documento 13287031", "Nro. 13287031"
 * - "Hola, mi dni es 13287031 gracias"
 *
 * Rechaza:
 * - Solo letras o frases sin números
 * - Números de 1-6 dígitos
 * - Números de 9+ dígitos (sin secuencia contigua de 7-8)
 */
export function extractDNI(message: string): DNIExtractionResult {
  // Paso 1: Buscar primero secuencias contiguas de 7-8 dígitos en el texto original
  // (con posibles separadores como puntos o espacios entre grupos de 3)
  const contiguousPattern = /\b(\d{1,3}[.\s]?\d{3}[.\s]?\d{3}|\d{7,8})\b/g
  const contiguousMatches: string[] = []

  let match: RegExpExecArray | null
  const rawCopy = message
  const patternCopy = /\b(\d{1,3}[.\s]?\d{3}[.\s]?\d{3}|\d{7,8})\b/g

  while ((match = patternCopy.exec(rawCopy)) !== null) {
    const digits = match[1].replace(/[\s.]/g, "")
    if (digits.length === 7 || digits.length === 8) {
      contiguousMatches.push(digits)
    }
  }

  // Si encontramos exactamente una secuencia válida contigua, usarla
  if (contiguousMatches.length === 1) {
    return { valid: true, dni: contiguousMatches[0], raw: message }
  }

  // Si hay múltiples, tomar la de 8 dígitos si la hay, sino la primera
  if (contiguousMatches.length > 1) {
    const eightDigit = contiguousMatches.find(d => d.length === 8)
    return { valid: true, dni: eightDigit || contiguousMatches[0], raw: message }
  }

  // Paso 2: Fallback - eliminar TODOS los no-dígitos y verificar
  const onlyDigits = message.replace(/\D/g, "")

  if (onlyDigits.length === 0) {
    return { valid: false, reason: "no_digits" }
  }

  if (onlyDigits.length < 7) {
    return { valid: false, reason: "too_short" }
  }

  if (onlyDigits.length === 7 || onlyDigits.length === 8) {
    return { valid: true, dni: onlyDigits, raw: message }
  }

  // Más de 8 dígitos totales - buscar subsecuencia contigua de 7-8
  const longMatch = message.match(/\d{7,8}/)
  if (longMatch) {
    const candidate = longMatch[0].substring(0, 8)
    if (candidate.length === 7 || candidate.length === 8) {
      return { valid: true, dni: candidate, raw: message }
    }
  }

  return { valid: false, reason: "too_long" }
}

/**
 * Resultado del handler de DNI
 */
export type DNIHandlerResult =
  | { handled: false }
  | { handled: true; type: "valid_dni"; dni: string; state: DNIAwaitingState }
  | { handled: true; type: "invalid_dni"; errorMessage: string; attemptsLeft: number }

const MAX_DNI_ATTEMPTS = 3

/**
 * Intercepta un mensaje cuando hay un estado awaiting_dni pendiente.
 * Retorna handled: false si no hay estado pendiente o si debe pasar a OpenAI.
 */
export async function handleDNIIfAwaiting(
  userMessage: string,
  phone: string,
  configId: string
): Promise<DNIHandlerResult> {
  const logger = createConversationLogger(phone, configId, "awaiting_dni")

  try {
    const state = await getDNIAwaitingState(phone, configId)
    if (!state) {
      return { handled: false }
    }

    logger.info("Estado awaiting_dni activo, procesando mensaje", {
      reason: state.reason,
      attempts: state.attempts,
    })

    const result = extractDNI(userMessage)

    if (result.valid) {
      logger.info("DNI valido extraido", { dni: result.dni, reason: state.reason })
      // Limpiar estado - el flujo continuará con el DNI
      await clearDNIAwaitingState(phone, configId)
      return {
        handled: true,
        type: "valid_dni",
        dni: result.dni,
        state,
      }
    }

    // DNI inválido - incrementar intentos
    state.attempts++
    const attemptsLeft = MAX_DNI_ATTEMPTS - state.attempts

    if (attemptsLeft <= 0) {
      logger.warn("Maximos intentos DNI alcanzados, limpiando estado y pasando a OpenAI")
      await clearDNIAwaitingState(phone, configId)
      return { handled: false } // Dejar que OpenAI maneje el caso excepcional
    }

    // Guardar estado actualizado con nuevo intento
    const redis = getRedisClient()
    if (redis) {
      const key = `${DNI_STATE_PREFIX}${configId}:${phone}`
      await redis.setex(key, TTL_SECONDS, JSON.stringify(state))
    }

    const errorMessage = buildDNIErrorMessage(result.reason)
    logger.warn("DNI invalido, solicitando reintento", {
      reason: result.reason,
      attemptsLeft,
    })

    return {
      handled: true,
      type: "invalid_dni",
      errorMessage,
      attemptsLeft,
    }
  } catch (error) {
    logger.error("Error en handleDNIIfAwaiting", error as Error)
    return { handled: false }
  }
}

/**
 * Genera el mensaje de error cuando el DNI no es válido.
 * Respeta las reglas del system prompt:
 * - NUNCA decir "contiene espacios" ni "contiene caracteres especiales"
 * - Mensaje estandarizado
 */
export function buildDNIErrorMessage(
  reason: "no_digits" | "too_short" | "too_long" | "ambiguous"
): string {
  // El system prompt especifica un mensaje único para cualquier caso inválido
  return "No pude identificar un DNI en tu mensaje. Por favor, enviame tu número de documento (7 u 8 dígitos)."
}

/**
 * Genera el mensaje de solicitud inicial de DNI
 */
export function buildRequestDNIMessage(): string {
  return "Para continuar con tu solicitud, necesito validar tu identidad. Por favor, indicame tu DNI."
}
