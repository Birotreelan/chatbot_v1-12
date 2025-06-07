import { createThread } from "@/lib/thread-manager"
import { getAssistantResponse } from "@/lib/openai-tools"
import { incrementMetric, logError } from "@/lib/monitoring"
import { rateLimit } from "@/lib/rate-limit"
import type { WhatsAppConfig } from "@/lib/types"

interface ProcessWebMessageParams {
  message: string
  sessionId: string
  config: WhatsAppConfig
  ip: string
}

export async function processWebMessage({ message, sessionId, config, ip }: ProcessWebMessageParams): Promise<string> {
  console.log(`[WEB-CHAT] Procesando mensaje para cliente_id: ${config.cliente_id}, sessionId: ${sessionId}`)

  try {
    // Aplicar rate limiting específico para web
    const rateLimitResult = await rateLimit(`web_session_${sessionId}`, 5) // 5 mensajes por minuto por sesión

    if (!rateLimitResult.success) {
      return "Has enviado demasiados mensajes. Por favor, espera un momento antes de enviar otro mensaje."
    }

    // Crear o obtener thread para esta sesión web
    console.log(`[WEB-CHAT] Creando/obteniendo thread para sesión: ${sessionId}`)

    let thread
    try {
      // Intentar obtener thread existente por sessionId
      thread = await getWebThread(sessionId, config.id)
    } catch (error) {
      console.log(`[WEB-CHAT] Thread no encontrado, creando nuevo thread para sesión: ${sessionId}`)
      thread = await createThread(sessionId, config.id)
    }

    console.log(`[WEB-CHAT] Thread obtenido/creado: ${thread.id}`)

    // Preparar el mensaje con contexto del cliente
    const contextualMessage = `[SISTEMA] PacienteCelular: web_${sessionId}
[SISTEMA] Cliente_Id: ${config.cliente_id}
[SISTEMA] Canal: Widget Web
[SISTEMA] Configuración: ${config.displayName}

${message}`

    console.log(`[WEB-CHAT] Enviando mensaje a OpenAI para thread: ${thread.id}`)

    // Procesar el mensaje usando el sistema de OpenAI existente
    await getAssistantResponse(
      thread.id,
      contextualMessage,
      config.phoneNumberId, // Usar phoneNumberId de la configuración
      config.assistantId || process.env.NEXT_PUBLIC_DEFAULT_ASSISTANT_ID || "",
    )

    // Como getAssistantResponse envía directamente a WhatsApp, necesitamos obtener la respuesta
    // Para web, necesitamos interceptar la respuesta antes de que se envíe a WhatsApp
    const response = await getLastAssistantMessage(thread.id)

    // Incrementar métricas
    await incrementMetric("web_messages_processed")

    console.log(`[WEB-CHAT] Mensaje procesado exitosamente para sesión: ${sessionId}`)
    return response
  } catch (error) {
    console.error(`[WEB-CHAT] Error al procesar mensaje:`, error)
    await logError("web_chat", error instanceof Error ? error : new Error(String(error)))

    return "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta nuevamente."
  }
}

// Función para obtener thread web existente
async function getWebThread(sessionId: string, configId: string) {
  const { getThread } = await import("@/lib/thread-manager")

  // Para web, usamos el sessionId como identificador único
  return await getThread(`web_${sessionId}`, configId)
}

// Función para obtener el último mensaje del asistente
async function getLastAssistantMessage(threadId: string): Promise<string> {
  try {
    const OpenAI = (await import("openai")).default
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })

    console.log(`[WEB-CHAT] Obteniendo último mensaje del thread: ${threadId}`)

    const messages = await openai.beta.threads.messages.list(threadId, {
      order: "desc",
      limit: 1,
    })

    if (messages.data.length === 0) {
      console.warn(`[WEB-CHAT] No se encontraron mensajes en el thread: ${threadId}`)
      return "No se pudo obtener una respuesta. Por favor, intenta nuevamente."
    }

    const lastMessage = messages.data[0]

    if (lastMessage.role !== "assistant") {
      console.warn(`[WEB-CHAT] El último mensaje no es del asistente: ${lastMessage.role}`)
      return "No se pudo obtener una respuesta del asistente. Por favor, intenta nuevamente."
    }

    // Extraer el contenido del mensaje
    let messageContent = ""
    for (const content of lastMessage.content) {
      if (content.type === "text") {
        messageContent += content.text.value
      }
    }

    console.log(`[WEB-CHAT] Mensaje del asistente obtenido: ${messageContent.length} caracteres`)
    return messageContent || "No se pudo obtener una respuesta. Por favor, intenta nuevamente."
  } catch (error) {
    console.error(`[WEB-CHAT] Error al obtener último mensaje:`, error)
    return "Error al obtener la respuesta. Por favor, intenta nuevamente."
  }
}
