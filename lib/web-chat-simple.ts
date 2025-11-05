import { incrementMetric, logError } from "@/lib/monitoring"
import { rateLimit } from "@/lib/rate-limit"
import type { WhatsAppConfig } from "@/lib/types"
import { OpenAI } from "openai"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

interface ProcessWebMessageParams {
  message: string
  sessionId: string
  config: WhatsAppConfig
  ip: string
}

export async function processWebMessage({ message, sessionId, config, ip }: ProcessWebMessageParams): Promise<string> {
  console.log(`[WEB-CHAT-SIMPLE] Procesando mensaje para cliente_id: ${config.cliente_id}, sessionId: ${sessionId}`)

  try {
    // Aplicar rate limiting específico para web
    const rateLimitResult = await rateLimit(`web_session_${sessionId}`, 5)

    if (!rateLimitResult.success) {
      return "Has enviado demasiados mensajes. Por favor, espera un momento antes de enviar otro mensaje."
    }

    // Limpiar sessionId para evitar duplicación
    const cleanSessionId = sessionId.replace(/^web_/, "") // Usar replace en lugar de slice
    const webSessionId = `web_${cleanSessionId}`

    console.log(`[WEB-CHAT-SIMPLE] SessionId original: ${sessionId}`)
    console.log(`[WEB-CHAT-SIMPLE] SessionId limpio: ${cleanSessionId}`)
    console.log(`[WEB-CHAT-SIMPLE] SessionId web: ${webSessionId}`)

    // Crear o obtener thread para esta sesión web
    let thread
    try {
      thread = await findWebThread(webSessionId, config.id)
      console.log(`[WEB-CHAT-SIMPLE] Thread encontrado: ${thread.id}`)
    } catch (error) {
      console.log(`[WEB-CHAT-SIMPLE] Thread no encontrado, creando nuevo`)
      thread = await createWebThread(webSessionId, config.id)
      console.log(`[WEB-CHAT-SIMPLE] Thread creado: ${thread.id}`)
    }

    // Preparar el mensaje con contexto del cliente
    const contextualMessage = `[SISTEMA] PacienteCelular: ${webSessionId}
[SISTEMA] Cliente_Id: ${config.cliente_id}
[SISTEMA] Canal: Widget Web
[SISTEMA] Configuración: ${config.displayName}

${message}`

    console.log(`[WEB-CHAT-SIMPLE] Enviando mensaje a OpenAI para thread: ${thread.id}`)
    console.log(`[WEB-CHAT-SIMPLE] ⚠️ IMPORTANTE: Este es un mensaje WEB - NO debe enviarse a WhatsApp`)

    // Procesar el mensaje
    const response = await processWebAssistantMessage(
      thread.id,
      contextualMessage,
      config.assistantId || process.env.NEXT_PUBLIC_DEFAULT_ASSISTANT_ID || "",
      config.cliente_id || "",
    )

    // Incrementar métricas
    await incrementMetric("web_messages_processed")

    console.log(`[WEB-CHAT-SIMPLE] ✅ Mensaje procesado exitosamente`)
    console.log(`[WEB-CHAT-SIMPLE] ✅ Respuesta obtenida SIN enviar a WhatsApp: ${response.length} caracteres`)

    return response
  } catch (error) {
    console.error(`[WEB-CHAT-SIMPLE] Error al procesar mensaje:`, error)
    await logError("web_chat", error instanceof Error ? error : new Error(String(error)))

    return "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta nuevamente."
  }
}

// Función para buscar thread web existente
async function findWebThread(sessionId: string, configId: string) {
  const threadName = `web-${sessionId}-${configId}`

  console.log(`[WEB-CHAT-SIMPLE] Buscando thread: ${threadName}`)

  const threads = await openai.beta.threads.list({
    limit: 20,
    order: "desc",
  })

  for (const thread of threads.data) {
    if (thread.metadata?.name === threadName || thread.metadata?.sessionId === sessionId) {
      console.log(`[WEB-CHAT-SIMPLE] Thread encontrado: ${thread.id}`)
      return thread
    }
  }

  throw new Error("Thread not found")
}

// Función para crear thread web
async function createWebThread(sessionId: string, configId: string) {
  const threadName = `web-${sessionId}-${configId}`

  console.log(`[WEB-CHAT-SIMPLE] Creando thread: ${threadName}`)

  const thread = await openai.beta.threads.create({
    metadata: {
      name: threadName,
      type: "web",
      sessionId,
      configId,
    },
  })

  console.log(`[WEB-CHAT-SIMPLE] Thread creado: ${thread.id}`)
  return thread
}

// Función específica para procesar mensajes web
async function processWebAssistantMessage(
  threadId: string,
  message: string,
  assistantId: string,
  clienteId: string,
): Promise<string> {
  console.log(`[WEB-ASSISTANT-SIMPLE] 🌐 Procesando mensaje web para thread: ${threadId}`)
  console.log(`[WEB-ASSISTANT-SIMPLE] 🚫 GARANTÍA: Este flujo NO enviará mensajes a WhatsApp`)
  console.log(`[WEB-ASSISTANT-SIMPLE] Assistant ID: ${assistantId}`)
  console.log(`[WEB-ASSISTANT-SIMPLE] Cliente ID: ${clienteId}`)

  // Validar parámetros
  if (!threadId || threadId === "undefined") {
    throw new Error(`Thread ID inválido: ${threadId}`)
  }

  if (!assistantId || assistantId === "undefined") {
    throw new Error(`Assistant ID inválido: ${assistantId}`)
  }

  try {
    // Añadir el mensaje al thread
    console.log(`[WEB-ASSISTANT-SIMPLE] Añadiendo mensaje al thread: ${threadId}`)
    const messageResponse = await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    })

    console.log(`[WEB-ASSISTANT-SIMPLE] Mensaje añadido: ${messageResponse.id}`)

    // Crear un run con el asistente
    console.log(`[WEB-ASSISTANT-SIMPLE] Creando run con assistant: ${assistantId}`)
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    })

    console.log(`[WEB-ASSISTANT-SIMPLE] Run creado: ${run.id}`)
    console.log(`[WEB-ASSISTANT-SIMPLE] Verificando threadId antes de waitForRunCompletion: ${threadId}`)

    // Esperar a que el run se complete
    await waitForRunCompletion(threadId, run.id, clienteId)

    console.log(`[WEB-ASSISTANT-SIMPLE] Run completado exitosamente`)

    // Obtener la respuesta del asistente
    const response = await getLastAssistantMessage(threadId)

    console.log(`[WEB-ASSISTANT-SIMPLE] ✅ Respuesta obtenida: ${response.length} caracteres`)
    console.log(`[WEB-ASSISTANT-SIMPLE] ✅ CONFIRMADO: No se envió nada a WhatsApp`)

    return response
  } catch (error) {
    console.error(`[WEB-ASSISTANT-SIMPLE] Error en processWebAssistantMessage:`, error)
    throw error
  }
}

// Función para esperar la completación del run
async function waitForRunCompletion(threadId: string, runId: string, clienteId: string): Promise<void> {
  // Validar parámetros antes de usar
  if (!threadId || threadId === "undefined") {
    throw new Error(`Thread ID inválido en waitForRunCompletion: ${threadId}`)
  }

  if (!runId || runId === "undefined") {
    throw new Error(`Run ID inválido en waitForRunCompletion: ${runId}`)
  }

  console.log(`[WEB-ASSISTANT-SIMPLE] Esperando completación del run: ${runId}`)
  console.log(`[WEB-ASSISTANT-SIMPLE] Thread ID válido: ${threadId}`)
  console.log(`[WEB-ASSISTANT-SIMPLE] Cliente ID: ${clienteId}`)

  let run = await openai.beta.threads.runs.retrieve(runId, {
    thread_id: threadId,
  })
  let pollCount = 0

  while (run.status === "queued" || run.status === "in_progress") {
    pollCount++
    console.log(`[WEB-ASSISTANT-SIMPLE] Poll ${pollCount}: Estado del run: ${run.status}`)

    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Validar threadId antes de cada llamada
    if (!threadId || threadId === "undefined") {
      throw new Error(`Thread ID se volvió inválido durante polling: ${threadId}`)
    }

    run = await openai.beta.threads.runs.retrieve(runId, {
      thread_id: threadId,
    })
  }

  console.log(`[WEB-ASSISTANT-SIMPLE] Run completado con estado: ${run.status}`)

  if (run.status === "requires_action") {
    console.log(`[WEB-ASSISTANT-SIMPLE] 🔧 Run requiere acción - procesando herramientas`)

    if (run.required_action?.type === "submit_tool_outputs") {
      const toolCalls = run.required_action.submit_tool_outputs.tool_calls
      const toolOutputs = []

      console.log(`[WEB-ASSISTANT-SIMPLE] Procesando ${toolCalls.length} herramientas`)

      for (const toolCall of toolCalls) {
        const functionName = toolCall.function.name
        const functionArgs = JSON.parse(toolCall.function.arguments)

        console.log(`[WEB-ASSISTANT-SIMPLE] 🔧 Ejecutando herramienta: ${functionName}`)

        // Importar la función de herramientas
        const { executeOpenAITool } = await import("@/lib/openai-tools")
        const toolResult = await executeOpenAITool(functionName, functionArgs, clienteId)

        console.log(`[WEB-ASSISTANT-SIMPLE] 🔧 Resultado de ${functionName}:`, toolResult)

        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: JSON.stringify(toolResult),
        })
      }

      console.log(`[WEB-ASSISTANT-SIMPLE] Enviando resultados de herramientas a OpenAI`)

      // Validar threadId antes de enviar tool outputs
      if (!threadId || threadId === "undefined") {
        throw new Error(`Thread ID inválido antes de submitToolOutputs: ${threadId}`)
      }

      // Enviar los resultados de las herramientas
      await openai.beta.threads.runs.submitToolOutputs(runId, {
        thread_id: threadId,
        tool_outputs: toolOutputs,
      })

      console.log(`[WEB-ASSISTANT-SIMPLE] Resultados enviados, continuando procesamiento`)

      // Continuar esperando la completación
      await waitForRunCompletion(threadId, runId, clienteId)
    }
  } else if (run.status === "failed") {
    console.error(`[WEB-ASSISTANT-SIMPLE] ❌ Run falló: ${run.last_error?.message}`)
    throw new Error(`Run falló: ${run.last_error?.message}`)
  } else if (run.status === "completed") {
    console.log(`[WEB-ASSISTANT-SIMPLE] ✅ Run completado exitosamente`)
  } else {
    console.warn(`[WEB-ASSISTANT-SIMPLE] ⚠️ Estado inesperado del run: ${run.status}`)
  }
}

// Función para obtener el último mensaje del asistente
async function getLastAssistantMessage(threadId: string): Promise<string> {
  try {
    console.log(`[WEB-ASSISTANT-SIMPLE] Obteniendo último mensaje del thread: ${threadId}`)

    const messages = await openai.beta.threads.messages.list(threadId, {
      order: "desc",
      limit: 1,
    })

    if (messages.data.length === 0) {
      console.warn(`[WEB-ASSISTANT-SIMPLE] No se encontraron mensajes en el thread: ${threadId}`)
      return "No se pudo obtener una respuesta. Por favor, intenta nuevamente."
    }

    const lastMessage = messages.data[0]

    if (lastMessage.role !== "assistant") {
      console.warn(`[WEB-ASSISTANT-SIMPLE] El último mensaje no es del asistente: ${lastMessage.role}`)
      return "No se pudo obtener una respuesta del asistente. Por favor, intenta nuevamente."
    }

    // Extraer el contenido del mensaje
    let messageContent = ""
    for (const content of lastMessage.content) {
      if (content.type === "text") {
        messageContent += content.text.value
      }
    }

    console.log(`[WEB-ASSISTANT-SIMPLE] ✅ Mensaje del asistente obtenido: ${messageContent.length} caracteres`)

    return messageContent || "No se pudo obtener una respuesta. Por favor, intenta nuevamente."
  } catch (error) {
    console.error(`[WEB-ASSISTANT-SIMPLE] Error al obtener último mensaje:`, error)
    return "Error al obtener la respuesta. Por favor, intenta nuevamente."
  }
}
