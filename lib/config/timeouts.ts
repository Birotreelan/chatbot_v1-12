// Configuración centralizada de timeouts para llamadas HTTP
// Todos los valores en milisegundos
// VERCEL PRO: maxDuration = 300 segundos (5 minutos)

import { Agent } from "undici"

export const TIMEOUTS = {
  // Timeout para llamadas al proxy externo (treelan.net)
  PROXY_TIMEOUT: Number.parseInt(process.env.PROXY_TIMEOUT || "280000", 10), // 280 segundos por defecto

  // Timeout para llamadas a la API de WhatsApp
  WHATSAPP_TIMEOUT: Number.parseInt(process.env.WHATSAPP_TIMEOUT || "120000", 10), // 120 segundos

  // Timeout para llamadas a OpenAI
  OPENAI_TIMEOUT: Number.parseInt(process.env.OPENAI_TIMEOUT || "280000", 10), // 280 segundos

  // Aumentamos a 120 segundos para cubrir servidores lentos
  CONNECT_TIMEOUT: Number.parseInt(process.env.CONNECT_TIMEOUT || "120000", 10), // 120 segundos
}

// Helper para crear AbortController con timeout
export function createTimeoutController(timeoutMs: number): { controller: AbortController; timeoutId: NodeJS.Timeout } {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  return { controller, timeoutId }
}

// Esto soluciona el error UND_ERR_CONNECT_TIMEOUT que ocurre a los 10 segundos
function createExtendedTimeoutAgent(connectTimeoutMs: number): Agent {
  return new Agent({
    connect: {
      timeout: connectTimeoutMs,
    },
    // También aumentar otros timeouts relacionados
    bodyTimeout: connectTimeoutMs,
    headersTimeout: connectTimeoutMs,
  })
}

// Helper para fetch con timeout extendido (incluye timeout de conexión)
export async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs: number): Promise<Response> {
  const { controller, timeoutId } = createTimeoutController(timeoutMs)

  // Usar el mayor entre el timeout solicitado y el CONNECT_TIMEOUT configurado
  const connectTimeout = Math.max(timeoutMs, TIMEOUTS.CONNECT_TIMEOUT)
  const agent = createExtendedTimeoutAgent(connectTimeout)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      // @ts-ignore - dispatcher es válido en Node.js pero no está en los tipos de RequestInit
      dispatcher: agent,
    })
    clearTimeout(timeoutId)
    return response
  } catch (error: any) {
    clearTimeout(timeoutId)
    if (error.name === "AbortError") {
      throw new Error(`Request timeout after ${timeoutMs}ms to ${url}`)
    }
    // Mejorar mensaje de error para ConnectTimeoutError
    if (error.cause?.code === "UND_ERR_CONNECT_TIMEOUT") {
      throw new Error(`Connection timeout after ${connectTimeout}ms to ${url}. El servidor externo no responde.`)
    }
    throw error
  } finally {
    // Cerrar el agent para liberar recursos
    await agent.close()
  }
}

// Errores que se pueden reintentar (transitorios)
const RETRYABLE_ERROR_CODES = [
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
]

const RETRYABLE_ERROR_MESSAGES = ["fetch failed", "network error", "socket hang up", "connection refused"]

function isRetryableError(error: any): boolean {
  // Verificar código de error
  const errorCode = error.cause?.code || error.code
  if (errorCode && RETRYABLE_ERROR_CODES.includes(errorCode)) {
    return true
  }

  // Verificar errno para ETIMEDOUT (-110 en Linux)
  if (error.cause?.errno === -110 || error.errno === -110) {
    return true
  }

  // Verificar mensaje de error
  const errorMessage = (error.message || "").toLowerCase()
  if (RETRYABLE_ERROR_MESSAGES.some((msg) => errorMessage.includes(msg))) {
    return true
  }

  return false
}

export interface RetryOptions {
  maxRetries?: number
  initialDelayMs?: number
  maxDelayMs?: number
  backoffMultiplier?: number
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelayMs: 2000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
}

// Función de espera
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Fetch con reintentos automáticos para errores de red
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  timeoutMs: number,
  retryOptions: RetryOptions = {},
): Promise<Response> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...retryOptions }
  let lastError: Error | null = null
  let currentDelay = opts.initialDelayMs

  for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
    try {
      console.log(`[FETCH-RETRY] Intento ${attempt}/${opts.maxRetries + 1} para ${url}`)
      const response = await fetchWithTimeout(url, options, timeoutMs)

      if (attempt > 1) {
        console.log(`[FETCH-RETRY] Éxito en intento ${attempt} para ${url}`)
      }

      return response
    } catch (error: any) {
      lastError = error

      // Verificar si el error es reinentable
      if (!isRetryableError(error)) {
        console.log(`[FETCH-RETRY] Error no reinentable: ${error.message}`)
        throw error
      }

      // Si es el último intento, no reintentar
      if (attempt > opts.maxRetries) {
        console.error(`[FETCH-RETRY] Todos los ${opts.maxRetries + 1} intentos fallaron para ${url}`)
        throw error
      }

      console.warn(
        `[FETCH-RETRY] Intento ${attempt} falló (${error.cause?.code || error.message}), reintentando en ${currentDelay}ms...`,
      )

      await sleep(currentDelay)
      currentDelay = Math.min(currentDelay * opts.backoffMultiplier, opts.maxDelayMs)
    }
  }

  // Esto no debería alcanzarse, pero por seguridad
  throw lastError || new Error("Fetch failed after retries")
}
