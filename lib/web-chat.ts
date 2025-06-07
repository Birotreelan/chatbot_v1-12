import { createThread } from "@/lib/thread-manager"
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
    const rateLimitResult = await rateLimit(`web_session_${sessionId}`, 5)

    if (!rateLimitResult.success) {
      return "Has enviado demasiados mensajes. Por favor, espera un momento antes de enviar otro mensaje."
    }

    // Crear o obtener thread para esta sesión web
    console.log(`[WEB-CHAT] Creando/obteniendo thread para sesión: ${sessionId}`)

    // Limpiar sessionId para evitar duplicación
    const cleanSessionId = sessionId.startsWith("web_") ? sessionId.slice(4) : sessionId
    const webSessionId = `web_${cleanSessionId}`

    console.log(`[WEB-CHAT] SessionId original: ${sessionId}`)
    console.log(`[WEB-CHAT] SessionId limpio: ${cleanSessionId}`)
    console.log(`[WEB-CHAT] SessionId web: ${webSessionId}`)

    let thread
    try {
      thread = await getWebThread(webSessionId, config.id)
    } catch (error) {
      console.log(`[WEB-CHAT] Thread no encontrado, creando nuevo thread para sesión: ${webSessionId}`)
      thread = await createThread(webSessionId, config.id)
    }

    console.log(`[WEB-CHAT] Thread obtenido/creado: ${thread.id}`)

    // Preparar el mensaje con contexto del cliente (sin duplicar web_)
    const contextualMessage = `[SISTEMA] PacienteCelular: ${webSessionId}
[SISTEMA] Cliente_Id: ${config.cliente_id}
[SISTEMA] Canal: Widget Web
[SISTEMA] Configuración: ${config.displayName}

${message}`

    console.log(`[WEB-CHAT] Enviando mensaje a OpenAI para thread: ${thread.id}`)
    console.log(`[WEB-CHAT] ⚠️ IMPORTANTE: Este es un mensaje WEB - NO debe enviarse a WhatsApp`)

    // USAR SOLO LA FUNCIÓN WEB - NUNCA getAssistantResponse
    const response = await processWebAssistantResponse(
      thread.id,
      contextualMessage,
      config.assistantId || process.env.NEXT_PUBLIC_DEFAULT_ASSISTANT_ID || "",
      config.cliente_id || "",
    )

    // Incrementar métricas
    await incrementMetric("web_messages_processed")

    console.log(`[WEB-CHAT] ✅ Mensaje procesado exitosamente para sesión: ${sessionId}`)
    console.log(`[WEB-CHAT] ✅ Respuesta obtenida SIN enviar a WhatsApp: ${response.length} caracteres`)

    return response
  } catch (error) {
    console.error(`[WEB-CHAT] Error al procesar mensaje:`, error)
    await logError("web_chat", error instanceof Error ? error : new Error(String(error)))

    return "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta nuevamente."
  }
}

// Función específica para procesar mensajes web sin enviar a WhatsApp
async function processWebAssistantResponse(
  threadId: string,
  message: string,
  assistantId: string,
  clienteId: string,
): Promise<string> {
  console.log(`[WEB-ASSISTANT] 🌐 Procesando mensaje web para thread: ${threadId}`)
  console.log(`[WEB-ASSISTANT] 🚫 GARANTÍA: Este flujo NO enviará mensajes a WhatsApp`)

  // Validar parámetros
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
    // Añadir el mensaje al thread
    const messageResponse = await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    })

    console.log(`[WEB-ASSISTANT] Mensaje añadido al thread: ${messageResponse.id}`)

    // Crear un run con el asistente
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    })

    console.log(`[WEB-ASSISTANT] Run creado: ${run.id}`)

    // Esperar a que el run se complete (versión simplificada)
    await waitForWebRunCompletion(openai, threadId, run.id, clienteId)

    console.log(`[WEB-ASSISTANT] Run completado exitosamente`)

    // Obtener la respuesta del asistente
    const response = await getLastAssistantMessage(threadId)

    console.log(`[WEB-ASSISTANT] ✅ Respuesta obtenida: ${response.length} caracteres`)
    console.log(`[WEB-ASSISTANT] ✅ CONFIRMADO: No se envió nada a WhatsApp`)

    return response
  } catch (error) {
    console.error(`[WEB-ASSISTANT] Error en processWebAssistantResponse:`, error)
    throw error
  }
}

// Función simplificada para esperar la completación del run web
async function waitForWebRunCompletion(openai: any, threadId: string, runId: string, clienteId: string): Promise<void> {
  console.log(`[WEB-ASSISTANT] Esperando completación del run: ${runId}`)
  console.log(`[WEB-ASSISTANT] Thread ID: ${threadId}`)
  console.log(`[WEB-ASSISTANT] Cliente ID: ${clienteId}`)

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
    console.log(`[WEB-ASSISTANT] Poll ${pollCount}: Estado del run: ${run.status}`)

    await new Promise((resolve) => setTimeout(resolve, 1000))
    run = await openai.beta.threads.runs.retrieve(threadId, runId)
  }

  console.log(`[WEB-ASSISTANT] Run completado con estado: ${run.status}`)

  if (run.status === "requires_action") {
    console.log(`[WEB-ASSISTANT] 🔧 Run requiere acción - procesando herramientas`)

    if (run.required_action?.type === "submit_tool_outputs") {
      const toolCalls = run.required_action.submit_tool_outputs.tool_calls
      const toolOutputs = []

      console.log(`[WEB-ASSISTANT] Procesando ${toolCalls.length} herramientas`)

      for (const toolCall of toolCalls) {
        const functionName = toolCall.function.name
        const functionArgs = JSON.parse(toolCall.function.arguments)

        console.log(`[WEB-ASSISTANT] 🔧 Ejecutando herramienta: ${functionName}`)
        console.log(`[WEB-ASSISTANT] 🔧 Argumentos:`, functionArgs)

        // Importar la función de herramientas
        const { executeOpenAITool } = await import("@/lib/openai-tools")
        const toolResult = await executeOpenAITool(functionName, functionArgs, clienteId)

        console.log(`[WEB-ASSISTANT] 🔧 Resultado de ${functionName}:`, toolResult)

        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: JSON.stringify(toolResult),
        })
      }

      console.log(`[WEB-ASSISTANT] Enviando resultados de herramientas a OpenAI`)

      // Enviar los resultados de las herramientas
      await openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
        tool_outputs: toolOutputs,
      })

      console.log(`[WEB-ASSISTANT] Resultados enviados, continuando procesamiento`)

      // Continuar esperando la completación
      await waitForWebRunCompletion(openai, threadId, runId, clienteId)
    }
  } else if (run.status === "failed") {
    console.error(`[WEB-ASSISTANT] ❌ Run falló: ${run.last_error?.message}`)
    throw new Error(`Run falló: ${run.last_error?.message}`)
  } else if (run.status === "completed") {
    console.log(`[WEB-ASSISTANT] ✅ Run completado exitosamente`)
  } else {
    console.warn(`[WEB-ASSISTANT] ⚠️ Estado inesperado del run: ${run.status}`)
  }
}

// Función para obtener thread web existente
async function getWebThread(sessionId: string, configId: string) {
  const { getThread } = await import("@/lib/thread-manager")

  // Usar el sessionId directamente (ya tiene el prefijo web_ si es necesario)
  return await getThread(sessionId, configId)
}

// Función para obtener el último mensaje del asistente
async function getLastAssistantMessage(threadId: string): Promise<string> {
  try {
    const OpenAI = (await import("openai")).default
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })

    console.log(`[WEB-ASSISTANT] Obteniendo último mensaje del thread: ${threadId}`)

    const messages = await openai.beta.threads.messages.list(threadId, {
      order: "desc",
      limit: 1,
    })

    if (messages.data.length === 0) {
      console.warn(`[WEB-ASSISTANT] No se encontraron mensajes en el thread: ${threadId}`)
      return "No se pudo obtener una respuesta. Por favor, intenta nuevamente."
    }

    const lastMessage = messages.data[0]

    if (lastMessage.role !== "assistant") {
      console.warn(`[WEB-ASSISTANT] El último mensaje no es del asistente: ${lastMessage.role}`)
      return "No se pudo obtener una respuesta del asistente. Por favor, intenta nuevamente."
    }

    // Extraer el contenido del mensaje
    let messageContent = ""
    for (const content of lastMessage.content) {
      if (content.type === "text") {
        messageContent += content.text.value
      }
    }

    console.log(`[WEB-ASSISTANT] ✅ Mensaje del asistente obtenido: ${messageContent.length} caracteres`)
    console.log(`[WEB-ASSISTANT] ✅ Contenido: "${messageContent.substring(0, 100)}..."`)

    return messageContent || "No se pudo obtener una respuesta. Por favor, intenta nuevamente."
  } catch (error) {
    console.error(`[WEB-ASSISTANT] Error al obtener último mensaje:`, error)
    return "Error al obtener la respuesta. Por favor, intenta nuevamente."
  }
}
