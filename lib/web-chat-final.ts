import OpenAI from "openai"
import { getAssistantResponse } from "./openai"
import { validateDNI, searchTurnos } from "./clinic-api"

// Inicializar OpenAI directamente en este archivo
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

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
}

export async function processWebMessage(params: ProcessWebMessageParams): Promise<string> {
  try {
    const { message, sessionId, config, ip } = params
    console.log(`[WEB-CHAT-FINAL] Procesando mensaje para sessionId: ${sessionId}`)
    console.log(`[WEB-CHAT-FINAL] Cliente: ${config.displayName}, IP: ${ip}`)

    // Validar parámetros
    if (!sessionId) {
      throw new Error("SessionId es requerido")
    }
    if (!message) {
      throw new Error("Message es requerido")
    }
    if (!config?.assistantId) {
      throw new Error("Config.assistantId es requerido")
    }

    // Limpiar sessionId de prefijos duplicados
    let cleanSessionId = sessionId
    while (cleanSessionId.startsWith("web_")) {
      cleanSessionId = cleanSessionId.substring(4)
    }
    console.log(`[WEB-CHAT-FINAL] SessionId limpio: ${cleanSessionId}`)

    // Crear identificador único para el thread
    const threadIdentifier = `web_${cleanSessionId}_${config.id}`
    console.log(`[WEB-CHAT-FINAL] Thread identifier: ${threadIdentifier}`)

    console.log(`[WEB-CHAT-FINAL] 🌐 Procesando mensaje web con getAssistantResponse`)
    console.log(`[WEB-CHAT-FINAL] 🚫 GARANTÍA: NO se enviará a WhatsApp`)

    // Usar la función getAssistantResponse existente que sabemos que funciona
    const response = await getAssistantResponse(
      message,
      threadIdentifier, // Usar como threadId
      config.assistantId,
      config.id, // clienteId
      false, // isWhatsApp = false para web
      {
        validate_dni: async (dni: string) => {
          console.log(`[WEB-CHAT-FINAL] Tool call: validate_dni para ${dni}`)
          return await validateDNI(dni)
        },
        search_turnos: async (dni: string) => {
          console.log(`[WEB-CHAT-FINAL] Tool call: search_turnos para ${dni}`)
          return await searchTurnos(dni)
        },
      },
    )

    console.log(`[WEB-CHAT-FINAL] ✅ Respuesta obtenida: ${response.length} caracteres`)
    return response
  } catch (error) {
    console.error("[WEB-CHAT-FINAL] Error al procesar mensaje:", error)
    return "Lo siento, ha ocurrido un error. Por favor, intenta nuevamente."
  }
}
