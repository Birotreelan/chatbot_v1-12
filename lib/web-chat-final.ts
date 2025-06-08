import { getThread } from "@/lib/thread-manager"
import { processWebOnlyMessage } from "@/lib/openai-web-processor" // Correct import path

interface WebChatConfig {
  id: string
  displayName: string
  assistantId: string
  enabled: boolean
  widgetEnabled: boolean
}

interface ProcessWebMessageParams {
  message: string
  sessionId: string
  config: WebChatConfig
  ip: string
  clienteId: string
}

export async function processWebMessage(params: ProcessWebMessageParams): Promise<string> {
  try {
    const { message, sessionId, config, ip, clienteId } = params

    console.log(`[WEB-CHAT-FINAL] ========== PROCESANDO MENSAJE WEB ==========`)
    console.log(`[WEB-CHAT-FINAL] Parámetros recibidos:`)
    console.log(`[WEB-CHAT-FINAL] - sessionId: "${sessionId}"`)
    console.log(`[WEB-CHAT-FINAL] - config.displayName: "${config.displayName}"`)
    console.log(`[WEB-CHAT-FINAL] - config.id: "${config.id}"`)
    console.log(`[WEB-CHAT-FINAL] - clienteId (REAL): "${clienteId}"`)
    console.log(`[WEB-CHAT-FINAL] - ip: "${ip}"`)
    console.log(`[WEB-CHAT-FINAL] - message: "${message}"`)
    console.log(`[WEB-CHAT-FINAL] ================================================`)

    // Validar parámetros
    if (!sessionId || !message || !config?.assistantId || !clienteId) {
      console.error(`[WEB-CHAT-FINAL] ❌ Parámetros requeridos faltantes`)
      throw new Error("Parámetros requeridos faltantes")
    }

    // Limpiar sessionId para crear un identificador único
    let cleanSessionId = sessionId
    while (cleanSessionId.startsWith("web_")) {
      cleanSessionId = cleanSessionId.substring(4)
    }

    // Crear un identificador único para el usuario web
    const webUserId = `web_${cleanSessionId}`
    console.log(`[WEB-CHAT-FINAL] 👤 Web User ID: ${webUserId}`)

    // Obtener o crear thread usando el mismo sistema que WhatsApp
    console.log(`[WEB-CHAT-FINAL] 🔄 Obteniendo thread...`)
    const thread = await getThread(webUserId, config.id)
    console.log(`[WEB-CHAT-FINAL] 🧵 Thread obtenido: ${thread.id}`)

    // Validar que el thread ID es válido
    if (!thread.id || typeof thread.id !== "string" || !thread.id.startsWith("thread_")) {
      console.error(`[WEB-CHAT-FINAL] ❌ Thread ID inválido: "${thread.id}"`)
      throw new Error(`Thread ID inválido: "${thread.id}"`)
    }

    // Procesar mensaje usando la nueva función dedicada para web
    console.log(`[WEB-CHAT-FINAL] 🚀 Procesando con OpenAI (sin WhatsApp)`)
    const response = await processWebOnlyMessage(thread.id, message, config.assistantId, clienteId)

    console.log(`[WEB-CHAT-FINAL] ✅ Respuesta obtenida: ${response.length} caracteres`)
    return response
  } catch (error) {
    console.error("[WEB-CHAT-FINAL] ❌ Error en processWebMessage:", error)
    return "Lo siento, ha ocurrido un error. Por favor, intenta nuevamente."
  }
}
