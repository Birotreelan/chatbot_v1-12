import { validateDNI, searchTurnos } from "./clinic-api"

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

// Cache simple para threads web
const webThreadsCache = new Map<string, string>()

export async function processWebMessage(params: ProcessWebMessageParams): Promise<string> {
  try {
    const { message, sessionId, config, ip } = params
    console.log(`[WEB-CHAT-FINAL] Procesando mensaje para sessionId: ${sessionId}`)
    console.log(`[WEB-CHAT-FINAL] Cliente: ${config.displayName}, IP: ${ip}`)

    // Validar parámetros
    if (!sessionId || !message || !config?.assistantId) {
      throw new Error("Parámetros requeridos faltantes")
    }

    // Limpiar sessionId
    let cleanSessionId = sessionId
    while (cleanSessionId.startsWith("web_")) {
      cleanSessionId = cleanSessionId.substring(4)
    }

    const threadKey = `${cleanSessionId}_${config.id}`
    console.log(`[WEB-CHAT-FINAL] Thread key: ${threadKey}`)

    // Obtener o crear thread
    let threadId = webThreadsCache.get(threadKey)
    if (!threadId) {
      threadId = await createWebThread(threadKey)
      webThreadsCache.set(threadKey, threadId)
    }

    console.log(`[WEB-CHAT-FINAL] 🌐 Usando thread: ${threadId}`)
    console.log(`[WEB-CHAT-FINAL] 🚫 GARANTÍA: NO se enviará a WhatsApp`)

    // Procesar mensaje - usar el cliente_id real de la configuración
    const response = await processMessageWithOpenAI(threadId, message, config.assistantId, params.config.id)
    console.log(`[WEB-CHAT-FINAL] ✅ Respuesta: ${response.length} caracteres`)

    return response
  } catch (error) {
    console.error("[WEB-CHAT-FINAL] Error:", error)
    return "Lo siento, ha ocurrido un error. Por favor, intenta nuevamente."
  }
}

async function createWebThread(identifier: string): Promise<string> {
  try {
    console.log(`[WEB-CHAT-FINAL] Creando thread para: ${identifier}`)

    const response = await fetch("https://api.openai.com/v1/threads", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2",
      },
      body: JSON.stringify({
        metadata: {
          identifier,
          type: "web",
          created_at: new Date().toISOString(),
        },
      }),
    })

    if (!response.ok) {
      throw new Error(`Error creating thread: ${response.status} ${response.statusText}`)
    }

    const thread = await response.json()
    console.log(`[WEB-CHAT-FINAL] Thread creado: ${thread.id}`)
    return thread.id
  } catch (error) {
    console.error("[WEB-CHAT-FINAL] Error creando thread:", error)
    throw error
  }
}

async function processMessageWithOpenAI(
  threadId: string,
  message: string,
  assistantId: string,
  clienteId: string,
): Promise<string> {
  try {
    // 1. Añadir mensaje al thread
    console.log(`[WEB-CHAT-FINAL] Añadiendo mensaje al thread: ${threadId}`)
    const messageResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2",
      },
      body: JSON.stringify({
        role: "user",
        content: message,
      }),
    })

    if (!messageResponse.ok) {
      throw new Error(`Error adding message: ${messageResponse.status}`)
    }

    const messageData = await messageResponse.json()
    console.log(`[WEB-CHAT-FINAL] Mensaje añadido: ${messageData.id}`)

    // 2. Crear run
    console.log(`[WEB-CHAT-FINAL] Creando run con assistant: ${assistantId}`)
    const runResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2",
      },
      body: JSON.stringify({
        assistant_id: assistantId,
        tools: [
          {
            type: "function",
            function: {
              name: "validate_dni",
              description: "Valida un DNI y obtiene información del paciente",
              parameters: {
                type: "object",
                properties: {
                  dni: { type: "string", description: "DNI a validar" },
                },
                required: ["dni"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "search_turnos",
              description: "Busca turnos disponibles para un paciente",
              parameters: {
                type: "object",
                properties: {
                  dni: { type: "string", description: "DNI del paciente" },
                },
                required: ["dni"],
              },
            },
          },
        ],
      }),
    })

    if (!runResponse.ok) {
      throw new Error(`Error creating run: ${runResponse.status}`)
    }

    const runData = await runResponse.json()
    console.log(`[WEB-CHAT-FINAL] Run creado: ${runData.id}`)

    // 3. Esperar completación
    const finalResponse = await waitForRunCompletion(threadId, runData.id, clienteId)
    return finalResponse
  } catch (error) {
    console.error("[WEB-CHAT-FINAL] Error procesando mensaje:", error)
    throw error
  }
}

async function waitForRunCompletion(threadId: string, runId: string, clienteId: string): Promise<string> {
  let attempts = 0
  const maxAttempts = 30

  while (attempts < maxAttempts) {
    try {
      console.log(`[WEB-CHAT-FINAL] Verificando run ${runId} (intento ${attempts + 1}/${maxAttempts})`)

      const runResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "OpenAI-Beta": "assistants=v2",
        },
      })

      if (!runResponse.ok) {
        throw new Error(`Error checking run: ${runResponse.status}`)
      }

      const run = await runResponse.json()
      console.log(`[WEB-CHAT-FINAL] Estado del run: ${run.status}`)

      if (run.status === "completed") {
        // Obtener mensajes
        const messagesResponse = await fetch(
          `https://api.openai.com/v1/threads/${threadId}/messages?limit=1&order=desc`,
          {
            headers: {
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              "OpenAI-Beta": "assistants=v2",
            },
          },
        )

        if (!messagesResponse.ok) {
          throw new Error(`Error getting messages: ${messagesResponse.status}`)
        }

        const messages = await messagesResponse.json()
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
        await handleToolCalls(threadId, runId, run, clienteId)
      } else if (run.status === "failed" || run.status === "cancelled" || run.status === "expired") {
        console.error(`[WEB-CHAT-FINAL] Run falló con estado: ${run.status}`)
        return "Lo siento, ha ocurrido un error procesando tu solicitud."
      }

      attempts++
      await new Promise((resolve) => setTimeout(resolve, 1000))
    } catch (error) {
      console.error(`[WEB-CHAT-FINAL] Error en intento ${attempts + 1}:`, error)
      attempts++
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  return "La solicitud está tomando más tiempo del esperado. Por favor, intenta nuevamente."
}

async function handleToolCalls(threadId: string, runId: string, run: any, clienteId: string): Promise<void> {
  try {
    console.log(`[WEB-CHAT-FINAL] Procesando ${run.required_action.submit_tool_outputs.tool_calls.length} tool calls`)

    const toolOutputs = []

    for (const toolCall of run.required_action.submit_tool_outputs.tool_calls) {
      console.log(`[WEB-CHAT-FINAL] Procesando tool call: ${toolCall.function.name}`)

      try {
        let output = ""
        const args = JSON.parse(toolCall.function.arguments)

        switch (toolCall.function.name) {
          case "validate_dni":
            console.log(`[WEB-CHAT-FINAL] Validando DNI: ${args.dni} para cliente: ${clienteId}`)
            const dniResult = await validateDNI(args.dni, clienteId)
            output = JSON.stringify(dniResult)
            break

          case "search_turnos":
            console.log(`[WEB-CHAT-FINAL] Buscando turnos para DNI: ${args.dni} para cliente: ${clienteId}`)
            // La función searchTurnos espera parámetros específicos
            const turnosResult = await searchTurnos(
              {
                rangoFechas: "hoy a mañana", // Rango por defecto
                dni: args.dni,
              },
              clienteId,
            )
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
    const submitResponse = await fetch(
      `https://api.openai.com/v1/threads/${threadId}/runs/${runId}/submit_tool_outputs`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "assistants=v2",
        },
        body: JSON.stringify({
          tool_outputs: toolOutputs,
        }),
      },
    )

    if (!submitResponse.ok) {
      throw new Error(`Error submitting tool outputs: ${submitResponse.status}`)
    }

    console.log(`[WEB-CHAT-FINAL] Tool outputs enviados correctamente`)
  } catch (error) {
    console.error("[WEB-CHAT-FINAL] Error en handleToolCalls:", error)
    throw error
  }
}
