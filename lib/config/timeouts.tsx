// Configuración centralizada de timeouts para llamadas HTTP
// Todos los valores en milisegundos

import { Agent } from "undici"

export const TIMEOUTS = {
  // Timeout para llamadas al proxy externo (treelan.net)
  PROXY_TIMEOUT: Number.parseInt(process.env.PROXY_TIMEOUT || "30000", 10), // 30 segundos por defecto

  // Timeout para llamadas a la API de WhatsApp
  WHATSAPP_TIMEOUT: Number.parseInt(process.env.WHATSAPP_TIMEOUT || "30000", 10), // 30 segundos

  // Timeout para llamadas a OpenAI
  OPENAI_TIMEOUT: Number.parseInt(process.env.OPENAI_TIMEOUT || "120000", 10), // 2 minutos

  // Aumentamos a 60 segundos para cubrir servidores lentos
  CONNECT_TIMEOUT: Number.parseInt(process.env.CONNECT_TIMEOUT || "60000", 10), // 60 segundos
}

export const RETRY_CONFIG = {
  // Número máximo de reintentos para llamadas al proxy
  PROXY_MAX_RETRIES: Number.parseInt(process.env.PROXY_MAX_RETRIES || "3", 10),

  // Delay base entre reintentos (en ms) - se usa backoff exponencial
  PROXY_RETRY_DELAY: Number.parseInt(process.env.PROXY_RETRY_DELAY || "2000", 10),
}

// Errores que son recuperables y vale la pena reintentar
export const RETRYABLE_ERRORS = [
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "UND_ERR_CONNECT_TIMEOUT",
  "fetch failed",
  "network error",
  "socket hang up",
]

// Helper para determinar si un error es recuperable
export function isRetryableError(error: any): boolean {
  const errorMessage = error?.message?.toLowerCase() || ""
  const errorCode = error?.cause?.code || error?.code || ""

  return RETRYABLE_ERRORS.some(
    (retryableError) => errorMessage.includes(retryableError.toLowerCase()) || errorCode === retryableError,
  )
}

// Helper para calcular delay con backoff exponencial
export function calculateBackoffDelay(attempt: number, baseDelay: number): number {
  // Backoff exponencial: baseDelay * 2^attempt (0, 1, 2...)
  // Ejemplo con baseDelay=2000: 2000ms, 4000ms, 8000ms
  return baseDelay * Math.pow(2, attempt)
}

// Helper para esperar un tiempo determinado
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
// </CHANGE>

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

export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  timeoutMs: number,
  maxRetries: number = RETRY_CONFIG.PROXY_MAX_RETRIES,
  baseDelay: number = RETRY_CONFIG.PROXY_RETRY_DELAY,
): Promise<Response> {
  let lastError: any

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = calculateBackoffDelay(attempt - 1, baseDelay)
        console.log(`[FETCH_RETRY] Reintento ${attempt}/${maxRetries} para ${url} después de ${delay}ms`)
        await sleep(delay)
      }

      const response = await fetchWithTimeout(url, options, timeoutMs)

      if (attempt > 0) {
        console.log(`[FETCH_RETRY] ✅ Éxito en reintento ${attempt} para ${url}`)
      }

      return response
    } catch (error: any) {
      lastError = error

      // Verificar si es un error recuperable
      if (isRetryableError(error)) {
        console.warn(
          `[FETCH_RETRY] ⚠️ Error recuperable en intento ${attempt + 1}/${maxRetries + 1} para ${url}: ${error.message}`,
        )

        // Si es el último intento, no reintentar
        if (attempt === maxRetries) {
          console.error(`[FETCH_RETRY] ❌ Todos los reintentos agotados (${maxRetries + 1} intentos) para ${url}`)
          break
        }
        // Continuar al siguiente intento
        continue
      }

      // Si no es recuperable, lanzar inmediatamente
      console.error(`[FETCH_RETRY] ❌ Error no recuperable para ${url}: ${error.message}`)
      throw error
    }
  }

  // Si llegamos aquí, todos los reintentos fallaron
  throw lastError
}
// </CHANGE>
