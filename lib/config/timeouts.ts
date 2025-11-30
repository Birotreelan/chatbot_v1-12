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
