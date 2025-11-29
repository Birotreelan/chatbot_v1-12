// Configuración centralizada de timeouts para llamadas HTTP
// Todos los valores en milisegundos

export const TIMEOUTS = {
  // Timeout para llamadas al proxy externo (treelan.net)
  PROXY_TIMEOUT: Number.parseInt(process.env.PROXY_TIMEOUT || "30000", 10), // 30 segundos por defecto

  // Timeout para llamadas a la API de WhatsApp
  WHATSAPP_TIMEOUT: Number.parseInt(process.env.WHATSAPP_TIMEOUT || "30000", 10), // 30 segundos

  // Timeout para llamadas a OpenAI
  OPENAI_TIMEOUT: Number.parseInt(process.env.OPENAI_TIMEOUT || "120000", 10), // 2 minutos
}

// Helper para crear AbortController con timeout
export function createTimeoutController(timeoutMs: number): { controller: AbortController; timeoutId: NodeJS.Timeout } {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  return { controller, timeoutId }
}

// Helper para fetch con timeout
export async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs: number): Promise<Response> {
  const { controller, timeoutId } = createTimeoutController(timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    return response
  } catch (error: any) {
    clearTimeout(timeoutId)
    if (error.name === "AbortError") {
      throw new Error(`Request timeout after ${timeoutMs}ms to ${url}`)
    }
    throw error
  }
}
