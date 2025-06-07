import { processWebOnlyMessage } from "./openai-tools"
import { getThread } from "@/lib/thread-manager"

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

// Cache simple para threads web - con TTL para evitar threads eternos
const webThreadsCache = new Map<string, { threadId: string; lastUsed: number }>()
const THREAD_TTL = 30 * 60 * 1000 // 30 minutos

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

    // ✅ USAR EL MISMO SISTEMA QUE WHATSAPP: Thread Manager
    console.log(`[WEB-CHAT-FINAL] 🔄 Usando Thread Manager como WhatsApp`)

    // Crear un identificador único para el usuario web
    const webUserId = `web_${cleanSessionId}`
    console.log(`[WEB-CHAT-FINAL] 👤 Web User ID: ${webUserId}`)

    // Obtener o crear thread usando el mismo sistema que WhatsApp
    const thread = await getThread(webUserId, config.id)
    console.log(`[WEB-CHAT-FINAL] 🧵 Thread obtenido: ${thread.id}`)

    // ✅ USAR LA MISMA FUNCIÓN QUE WHATSAPP PERO SIN ENVIAR A WHATSAPP
    console.log(`[WEB-CHAT-FINAL] 🚀 Procesando con OpenAI (sin WhatsApp)`)
    const response = await processWebOnlyMessage(thread.id, message, config.assistantId, clienteId)

    console.log(`[WEB-CHAT-FINAL] ✅ Respuesta obtenida: ${response.length} caracteres`)
    return response
  } catch (error) {
    console.error("[WEB-CHAT-FINAL] ❌ Error en processWebMessage:", error)
    return "Lo siento, ha ocurrido un error. Por favor, intenta nuevamente."
  }
}

// Función para limpiar threads expirados
function cleanExpiredThreads() {
  const now = Date.now()
  const expiredKeys: string[] = []

  for (const [key, value] of webThreadsCache.entries()) {
    if (now - value.lastUsed > THREAD_TTL) {
      expiredKeys.push(key)
    }
  }

  for (const key of expiredKeys) {
    webThreadsCache.delete(key)
    console.log(`[WEB-CHAT-FINAL] 🧹 Thread expirado eliminado: ${key}`)
  }

  if (expiredKeys.length > 0) {
    console.log(`[WEB-CHAT-FINAL] 🧹 Limpieza completada: ${expiredKeys.length} threads eliminados`)
  }
}
