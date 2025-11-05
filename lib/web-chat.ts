import { createThread } from "@/lib/thread-manager"
import { incrementMetric, logError } from "@/lib/monitoring"
import { rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"
import type { WhatsAppConfig } from "@/lib/types"

interface ProcessWebMessageParams {
  message: string
  sessionId: string
  config: WhatsAppConfig
  ip: string
}

export async function processWebMessage({ message, sessionId, config, ip }: ProcessWebMessageParams): Promise<string> {
  logger.debug("WEB-CHAT", `Procesando: ${sessionId}`)

  try {
    const rateLimitResult = await rateLimit(`web_session_${sessionId}`, 5)

    if (!rateLimitResult.success) {
      return "Has enviado demasiados mensajes. Por favor, espera un momento antes de enviar otro mensaje."
    }

    const cleanSessionId = sessionId.startsWith("web_") ? sessionId.slice(4) : sessionId
    const webSessionId = `web_${cleanSessionId}`

    let thread
    try {
      thread = await getWebThread(webSessionId, config.id)
    } catch (error) {
      logger.debug("WEB-CHAT", `Creando thread: ${webSessionId}`)
      thread = await createThread(webSessionId, config.id)
    }

    const contextualMessage = `[SISTEMA] PacienteCelular: ${webSessionId}
[SISTEMA] Cliente_Id: ${config.cliente_id}
[SISTEMA] Canal: Widget Web
[SISTEMA] Configuración: ${config.displayName}

${message}`

    const response = await processWebAssistantResponse(
      thread.id,
      contextualMessage,
      config.assistantId || process.env.NEXT_PUBLIC_DEFAULT_ASSISTANT_ID || "",
      config.cliente_id || "",
    )

    await incrementMetric("web_messages_processed")

    logger.info("WEB-CHAT", `Procesado ✓: ${sessionId} (${response.length} chars)`)

    return response
  } catch (error) {
    logger.error("WEB-CHAT", "Error procesando mensaje", error)
    await logError("web_chat", error instanceof Error ? error : new Error(String(error)))

    return "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta nuevamente."
  }
}

async function processWebAssistantResponse(
  threadId: string,
  message: string,
  assistantId: string,
  clienteId: string,
): Promise<string> {
  logger.debug("WEB-ASSISTANT", `Procesando thread: ${threadId}`)

  if (!threadId || threadId === "undefined") {
    throw new Error(`Thread ID inválido: ${threadId}`)
  }

  if (!assistantId || assistantId === "undefined") {
    throw new Error(`Assistant ID inválido: ${assistantId}`)
  }

  const OpenAI = (await import("openai")).default
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })

  try {
    const messageResponse = await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    })

    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    })

    logger.debug("WEB-ASSISTANT", `Run creado: ${run.id}`)

    await waitForWebRunCompletion(openai, threadId, run.id, clienteId)

    const response = await getLastAssistantMessage(threadId)

    logger.info("WEB-ASSISTANT", `Respuesta obtenida ✓ (${response.length} chars)`)

    return response
  } catch (error) {
    logger.error("WEB-ASSISTANT", "Error en processWebAssistantResponse", error)
    throw error
  }
}

async function waitForWebRunCompletion(openai: any, threadId: string, runId: string, clienteId: string): Promise<void> {
  if (!threadId || threadId === "undefined") {
    throw new Error(`Thread ID inválido: ${threadId}`)
  }

  if (!runId || runId === "undefined") {
    throw new Error(`Run ID inválido: ${runId}`)
  }

  let run = await openai.beta.threads.runs.retrieve(threadId, runId)
  let pollCount = 0

  while (run.status === "queued" || run.status === "in_progress") {
    pollCount++

    if (pollCount % 5 === 0) {
      logger.debug("WEB-ASSISTANT", `Polling... (${pollCount} intentos, estado: ${run.status})`)
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
    run = await openai.beta.threads.runs.retrieve(threadId, runId)
  }

  logger.debug("WEB-ASSISTANT", `Run completado: ${run.status}`)

  if (run.status === "requires_action") {
    if (run.required_action?.type === "submit_tool_outputs") {
      const toolCalls = run.required_action.submit_tool_outputs.tool_calls
      const toolOutputs = []

      logger.info("WEB-ASSISTANT", `Ejecutando ${toolCalls.length} herramientas`)

      for (const toolCall of toolCalls) {
        const functionName = toolCall.function.name
        const functionArgs = JSON.parse(toolCall.function.arguments)

        logger.debug("WEB-ASSISTANT", `Ejecutando: ${functionName}`)

        const { executeOpenAITool } = await import("@/lib/openai-tools")
        const toolResult = await executeOpenAITool(functionName, functionArgs, clienteId)

        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: JSON.stringify(toolResult),
        })
      }

      await openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
        tool_outputs: toolOutputs,
      })

      logger.debug("WEB-ASSISTANT", "Resultados enviados, continuando")

      await waitForWebRunCompletion(openai, threadId, runId, clienteId)
    }
  } else if (run.status === "failed") {
    logger.error("WEB-ASSISTANT", `Run falló: ${run.last_error?.message}`)
    throw new Error(`Run falló: ${run.last_error?.message}`)
  }
}

async function getWebThread(sessionId: string, configId: string) {
  const { getThread } = await import("@/lib/thread-manager")
  return await getThread(sessionId, configId)
}

async function getLastAssistantMessage(threadId: string): Promise<string> {
  try {
    const OpenAI = (await import("openai")).default
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })

    const messages = await openai.beta.threads.messages.list(threadId, {
      order: "desc",
      limit: 1,
    })

    if (messages.data.length === 0) {
      logger.warn("WEB-ASSISTANT", "No se encontraron mensajes")
      return "No se pudo obtener una respuesta. Por favor, intenta nuevamente."
    }

    const lastMessage = messages.data[0]

    if (lastMessage.role !== "assistant") {
      logger.warn("WEB-ASSISTANT", `Último mensaje no es del asistente: ${lastMessage.role}`)
      return "No se pudo obtener una respuesta del asistente. Por favor, intenta nuevamente."
    }

    let messageContent = ""
    for (const content of lastMessage.content) {
      if (content.type === "text") {
        messageContent += content.text.value
      }
    }

    logger.debug("WEB-ASSISTANT", `Mensaje obtenido (${messageContent.length} chars)`)

    return messageContent || "No se pudo obtener una respuesta. Por favor, intenta nuevamente."
  } catch (error) {
    logger.error("WEB-ASSISTANT", "Error obteniendo último mensaje", error)
    return "Error al obtener la respuesta. Por favor, intenta nuevamente."
  }
}
