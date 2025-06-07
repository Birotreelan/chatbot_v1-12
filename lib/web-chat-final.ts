import OpenAI from "openai"
import { validateDNI, searchTurnos } from "./clinic-api"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

interface WebChatConfig {
  id: string
  name: string
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
    console.log(`[WEB-CHAT-FINAL] Cliente: ${config.name}, IP: ${ip}`)

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
    const threadIdentifier = `${cleanSessionId}_${config.id}`
    console.log(`[WEB-CHAT-FINAL] Thread identifier: ${threadIdentifier}`)

    // Obtener o crear thread
    const threadId = await getOrCreateWebThread(threadIdentifier)
    console.log(`[WEB-CHAT-FINAL] Thread obtenido: ${threadId}`)

    // Validar threadId
    if (!threadId || !threadId.startsWith("thread_")) {
      throw new Error(`Thread ID inválido: ${threadId}`)
    }

    // Procesar mensaje con OpenAI
    const response = await processWithOpenAI(threadId, message, config.assistantId)
    console.log(`[WEB-CHAT-FINAL] ✅ Respuesta obtenida: ${response.length} caracteres`)

    return response
  } catch (error) {
    console.error("[WEB-CHAT-FINAL] Error al procesar mensaje:", error)
    return "Lo siento, ha ocurrido un error. Por favor, intenta nuevamente."
  }
}

async function getOrCreateWebThread(identifier: string): Promise<string> {
  try {
    console.log(`[WEB-CHAT-FINAL] Buscando thread: ${identifier}`)

    // Buscar thread existente
    const threads = await openai.beta.threads.list({
      limit: 100,
    })

    const existingThread = threads.data.find(
      (thread) => thread.metadata?.identifier === identifier && thread.metadata?.type === "web",
    )

    if (existingThread) {
      console.log(`[WEB-CHAT-FINAL] Thread encontrado: ${existingThread.id}`)
      return existingThread.id
    }

    // Crear nuevo thread
    console.log(`[WEB-CHAT-FINAL] Creando nuevo thread: ${identifier}`)
    const newThread = await openai.beta.threads.create({
      metadata: {
        identifier,
        type: "web",
        created_at: new Date().toISOString(),
      },
    })

    console.log(`[WEB-CHAT-FINAL] Thread creado: ${newThread.id}`)
    return newThread.id
  } catch (error) {
    console.error("[WEB-CHAT-FINAL] Error en getOrCreateWebThread:", error)
    throw error
  }
}

async function processWithOpenAI(threadId: string, message: string, assistantId: string): Promise<string> {
  try {
    console.log(`[WEB-CHAT-FINAL] 🌐 Procesando con OpenAI - Thread: ${threadId}`)
    console.log(`[WEB-CHAT-FINAL] 🚫 GARANTÍA: NO se enviará a WhatsApp`)

    // Validar parámetros
    if (!threadId.startsWith("thread_")) {
      throw new Error(`Thread ID inválido: ${threadId}`)
    }
    if (!assistantId.startsWith("asst_")) {
      throw new Error(`Assistant ID inválido: ${assistantId}`)
    }

    // Añadir mensaje al thread
    console.log(`[WEB-CHAT-FINAL] Añadiendo mensaje al thread: ${threadId}`)
    const messageObj = await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    })
    console.log(`[WEB-CHAT-FINAL] Mensaje añadido: ${messageObj.id}`)

    // Crear run
    console.log(`[WEB-CHAT-FINAL] Creando run con assistant: ${assistantId}`)
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
      tools: [
        { type: "function", function: { name: "validate_dni" } },
        { type: "function", function: { name: "search_turnos" } },
      ],
    })
    console.log(`[WEB-CHAT-FINAL] Run creado: ${run.id}`)

    // Esperar completación
    const finalResponse = await waitForCompletion(threadId, run.id)
    return finalResponse
  } catch (error) {
    console.error("[WEB-CHAT-FINAL] Error en processWithOpenAI:", error)
    throw error
  }
}

async function waitForCompletion(threadId: string, runId: string): Promise<string> {
  try {
    console.log(`[WEB-CHAT-FINAL] Esperando completación - Thread: ${threadId}, Run: ${runId}`)

    // Validar parámetros antes de usar
    if (!threadId || !threadId.startsWith("thread_")) {
      throw new Error(`Thread ID inválido en waitForCompletion: ${threadId}`)
    }
    if (!runId || !runId.startsWith("run_")) {
      throw new Error(`Run ID inválido en waitForCompletion: ${runId}`)
    }

    let attempts = 0
    const maxAttempts = 30

    while (attempts < maxAttempts) {
      console.log(`[WEB-CHAT-FINAL] Intento ${attempts + 1}/${maxAttempts} - Verificando run: ${runId}`)

      const run = await openai.beta.threads.runs.retrieve(threadId, runId)
      console.log(`[WEB-CHAT-FINAL] Estado del run: ${run.status}`)

      if (run.status === "completed") {
        // Obtener mensajes
        const messages = await openai.beta.threads.messages.list(threadId, {
          limit: 1,
          order: "desc",
        })

        if (messages.data.length > 0) {
          const lastMessage = messages.data[0]
          if (lastMessage.content[0]?.type === "text") {
            const response = lastMessage.content[0].text.value
            console.log(`[WEB-CHAT-FINAL] ✅ Respuesta obtenida: ${response.length} caracteres`)
            return response
          }
        }

        return "Respuesta procesada correctamente."
      } else if (run.status === "requires_action") {
        console.log(`[WEB-CHAT-FINAL] Run requiere acción - procesando tool calls`)
        await handleToolCalls(threadId, runId, run)
      } else if (run.status === "failed" || run.status === "cancelled" || run.status === "expired") {
        console.error(`[WEB-CHAT-FINAL] Run falló con estado: ${run.status}`)
        return "Lo siento, ha ocurrido un error procesando tu solicitud."
      }

      attempts++
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    console.error(`[WEB-CHAT-FINAL] Timeout esperando completación del run: ${runId}`)
    return "La solicitud está tomando más tiempo del esperado. Por favor, intenta nuevamente."
  } catch (error) {
    console.error("[WEB-CHAT-FINAL] Error en waitForCompletion:", error)
    throw error
  }
}

async function handleToolCalls(threadId: string, runId: string, run: any): Promise<void> {
  try {
    console.log(`[WEB-CHAT-FINAL] Procesando tool calls para run: ${runId}`)

    const toolOutputs = []

    for (const toolCall of run.required_action.submit_tool_outputs.tool_calls) {
      console.log(`[WEB-CHAT-FINAL] Procesando tool call: ${toolCall.function.name}`)

      try {
        let output = ""
        const args = JSON.parse(toolCall.function.arguments)

        switch (toolCall.function.name) {
          case "validate_dni":
            console.log(`[WEB-CHAT-FINAL] Validando DNI: ${args.dni}`)
            const dniResult = await validateDNI(args.dni)
            output = JSON.stringify(dniResult)
            break

          case "search_turnos":
            console.log(`[WEB-CHAT-FINAL] Buscando turnos para DNI: ${args.dni}`)
            const turnosResult = await searchTurnos(args.dni)
            output = JSON.stringify(turnosResult)
            break

          default:
            console.log(`[WEB-CHAT-FINAL] Tool call no reconocido: ${toolCall.function.name}`)
            output = JSON.stringify({ error: "Función no disponible" })
        }

        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: output,
        })
      } catch (error) {
        console.error(`[WEB-CHAT-FINAL] Error en tool call ${toolCall.function.name}:`, error)
        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: JSON.stringify({ error: "Error procesando la solicitud" }),
        })
      }
    }

    // Enviar tool outputs
    console.log(`[WEB-CHAT-FINAL] Enviando ${toolOutputs.length} tool outputs`)
    await openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
      tool_outputs: toolOutputs,
    })
  } catch (error) {
    console.error("[WEB-CHAT-FINAL] Error en handleToolCalls:", error)
    throw error
  }
}
