import { getThread, createThread } from "./thread-manager"
import { processIndividualMessage } from "./openai-tools"
import { incrementStats } from "./monitoring"
import type { WhatsAppConfig } from "./types"

interface ProcessWebMessageParams {
  message: string
  sessionId: string
  config: WhatsAppConfig
  ip: string
}

export async function processWebMessage({ message, sessionId, config, ip }: ProcessWebMessageParams): Promise<string> {
  try {
    console.log(`[WEB-CHAT] Procesando mensaje para cliente_id: ${config.cliente_id}, sessionId: ${sessionId}`)

    // Crear o recuperar thread
    const threadId = await getThread(sessionId)

    if (!threadId) {
      console.log(`[WEB-CHAT] Thread no encontrado, creando uno nuevo para sessionId: ${sessionId}`)
      await createThread(sessionId)
    }

    // Preparar contexto del usuario
    const userContext = {
      PacienteNombre: "",
      PacienteDNI: "",
      PacienteCelular: "",
      cliente_id: config.cliente_id || "",
      proxy: config.proxy || "",
      from_web: true,
      ip,
    }

    // Procesar el mensaje
    const response = await processIndividualMessage({
      message,
      threadId: threadId || "",
      assistantId: config.assistantId,
      userContext,
      phoneNumberId: "web",
      wabaId: "web",
      accessToken: "web",
      from: sessionId,
    })

    // Actualizar estadísticas
    await incrementStats(config.id, "webMessagesReceived")

    return response
  } catch (error) {
    console.error("[WEB-CHAT] Error al procesar mensaje:", error)
    return "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta de nuevo más tarde."
  }
}
