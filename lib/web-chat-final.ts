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
      console.error(`[WEB-CHAT-FINAL] - sessionId: ${!!sessionId}`)
      console.error(`[WEB-CHAT-FINAL] - message: ${!!message}`)
      console.error(`[WEB-CHAT-FINAL] - assistantId: ${!!config?.assistantId}`)
      console.error(`[WEB-CHAT-FINAL] - clienteId: ${!!clienteId}`)
      throw new Error("Parámetros requeridos faltantes")
    }

    // Limpiar sessionId
    let cleanSessionId = sessionId
    while (cleanSessionId.startsWith("web_")) {
      cleanSessionId = cleanSessionId.substring(4)
    }

    // ✅ CREAR THREAD KEY ÚNICO POR CONVERSACIÓN
    const threadKey = `${cleanSessionId}_${config.id}_${Date.now()}`
    console.log(`[WEB-CHAT-FINAL] 🔑 Thread key generado: ${threadKey}`)

    // Limpiar threads expirados
    cleanExpiredThreads()

    // ✅ SIEMPRE CREAR UN NUEVO THREAD PARA EVITAR DOBLE SALUDO
    console.log(`[WEB-CHAT-FINAL] 🆕 Creando nuevo thread para evitar historial previo`)
    const threadId = await createWebThread(threadKey)

    // Guardar en cache con timestamp
    webThreadsCache.set(threadKey, {
      threadId,
      lastUsed: Date.now(),
    })

    console.log(`[WEB-CHAT-FINAL] 🌐 Usando thread: ${threadId}`)
    console.log(`[WEB-CHAT-FINAL] 🚫 GARANTÍA: NO se enviará a WhatsApp`)

    // Procesar mensaje - USAR EL CLIENTE_ID REAL
    console.log(`[WEB-CHAT-FINAL] 🚀 Iniciando procesamiento con OpenAI`)
    console.log(`[WEB-CHAT-FINAL] 🔑 Cliente ID que se usará: "${clienteId}"`)
    const response = await processMessageWithOpenAI(threadId, message, config.assistantId, clienteId)

    console.log(`[WEB-CHAT-FINAL] ✅ Procesamiento completado`)
    console.log(`[WEB-CHAT-FINAL] ✅ Respuesta: ${response.length} caracteres`)

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

async function createWebThread(identifier: string): Promise<string> {
  try {
    console.log(`[WEB-CHAT-FINAL] 🔧 Creando thread para: ${identifier}`)

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
      const errorText = await response.text()
      console.error(`[WEB-CHAT-FINAL] ❌ Error creando thread: ${response.status} ${errorText}`)
      throw new Error(`Error creating thread: ${response.status} ${response.statusText}`)
    }

    const thread = await response.json()
    console.log(`[WEB-CHAT-FINAL] ✅ Thread creado exitosamente: ${thread.id}`)
    return thread.id
  } catch (error) {
    console.error("[WEB-CHAT-FINAL] ❌ Error creando thread:", error)
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
    console.log(`[WEB-CHAT-FINAL] ========== PROCESANDO CON OPENAI ==========`)
    console.log(`[WEB-CHAT-FINAL] - threadId: ${threadId}`)
    console.log(`[WEB-CHAT-FINAL] - assistantId: ${assistantId}`)
    console.log(`[WEB-CHAT-FINAL] - clienteId: ${clienteId}`)
    console.log(`[WEB-CHAT-FINAL] - message: "${message}"`)

    // 1. Añadir mensaje al thread
    console.log(`[WEB-CHAT-FINAL] 📝 Añadiendo mensaje al thread: ${threadId}`)
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
      const errorText = await messageResponse.text()
      console.error(`[WEB-CHAT-FINAL] ❌ Error añadiendo mensaje: ${messageResponse.status} ${errorText}`)
      throw new Error(`Error adding message: ${messageResponse.status}`)
    }

    const messageData = await messageResponse.json()
    console.log(`[WEB-CHAT-FINAL] ✅ Mensaje añadido: ${messageData.id}`)

    // 2. Crear run
    console.log(`[WEB-CHAT-FINAL] 🏃 Creando run con assistant: ${assistantId}`)
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
              description: "Busca turnos disponibles",
              parameters: {
                type: "object",
                properties: {
                  rangoFechas: {
                    type: "string",
                    description: "Rango de fechas en formato 'YYYY-MM-DD a YYYY-MM-DD'",
                  },
                  profesional: {
                    type: "string",
                    description: "Nombre del profesional (opcional)",
                  },
                  especialidad: {
                    type: "string",
                    description: "Especialidad médica (opcional)",
                  },
                },
                required: ["rangoFechas"],
              },
            },
          },
        ],
      }),
    })

    if (!runResponse.ok) {
      const errorText = await runResponse.text()
      console.error(`[WEB-CHAT-FINAL] ❌ Error creando run: ${runResponse.status} ${errorText}`)
      throw new Error(`Error creating run: ${runResponse.status}`)
    }

    const runData = await runResponse.json()
    console.log(`[WEB-CHAT-FINAL] ✅ Run creado: ${runData.id}`)

    // 3. Esperar completación
    console.log(`[WEB-CHAT-FINAL] ⏳ Esperando completación del run...`)
    const finalResponse = await waitForRunCompletion(threadId, runData.id, clienteId)
    return finalResponse
  } catch (error) {
    console.error("[WEB-CHAT-FINAL] ❌ Error procesando mensaje:", error)
    throw error
  }
}

async function waitForRunCompletion(threadId: string, runId: string, clienteId: string): Promise<string> {
  let attempts = 0
  const maxAttempts = 30

  console.log(`[WEB-CHAT-FINAL] ⏳ Iniciando espera de completación para run: ${runId}`)

  while (attempts < maxAttempts) {
    try {
      console.log(`[WEB-CHAT-FINAL] 🔄 Verificando run ${runId} (intento ${attempts + 1}/${maxAttempts})`)

      const runResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "OpenAI-Beta": "assistants=v2",
        },
      })

      if (!runResponse.ok) {
        const errorText = await runResponse.text()
        console.error(`[WEB-CHAT-FINAL] ❌ Error verificando run: ${runResponse.status} ${errorText}`)
        throw new Error(`Error checking run: ${runResponse.status}`)
      }

      const run = await runResponse.json()
      console.log(`[WEB-CHAT-FINAL] 📊 Estado del run: ${run.status}`)

      if (run.status === "completed") {
        console.log(`[WEB-CHAT-FINAL] ✅ Run completado, obteniendo mensajes...`)

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
          const errorText = await messagesResponse.text()
          console.error(`[WEB-CHAT-FINAL] ❌ Error obteniendo mensajes: ${messagesResponse.status} ${errorText}`)
          throw new Error(`Error getting messages: ${messagesResponse.status}`)
        }

        const messages = await messagesResponse.json()
        if (messages.data.length > 0) {
          const lastMessage = messages.data[0]
          if (lastMessage.content[0]?.type === "text") {
            const response = lastMessage.content[0].text.value
            console.log(`[WEB-CHAT-FINAL] ✅ Respuesta obtenida: ${response.length} caracteres`)
            console.log(`[WEB-CHAT-FINAL] 📝 Contenido: "${response.substring(0, 100)}..."`)
            return response
          }
        }

        console.log(`[WEB-CHAT-FINAL] ⚠️ No se encontró contenido de texto en la respuesta`)
        return "Respuesta procesada correctamente."
      } else if (run.status === "requires_action") {
        console.log(`[WEB-CHAT-FINAL] 🔧 Run requiere acción - procesando tool calls`)
        await handleToolCalls(threadId, runId, run, clienteId)
      } else if (run.status === "failed" || run.status === "cancelled" || run.status === "expired") {
        console.error(`[WEB-CHAT-FINAL] ❌ Run falló con estado: ${run.status}`)
        if (run.last_error) {
          console.error(`[WEB-CHAT-FINAL] ❌ Error detallado:`, run.last_error)
        }
        return "Lo siento, ha ocurrido un error procesando tu solicitud."
      }

      attempts++
      await new Promise((resolve) => setTimeout(resolve, 1000))
    } catch (error) {
      console.error(`[WEB-CHAT-FINAL] ❌ Error en intento ${attempts + 1}:`, error)
      attempts++
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  console.error(`[WEB-CHAT-FINAL] ❌ Timeout: Run no completó en ${maxAttempts} intentos`)
  return "La solicitud está tomando más tiempo del esperado. Por favor, intenta nuevamente."
}

async function handleToolCalls(threadId: string, runId: string, run: any, clienteId: string): Promise<void> {
  try {
    const toolCalls = run.required_action.submit_tool_outputs.tool_calls
    console.log(`[WEB-CHAT-FINAL] ========== PROCESANDO TOOL CALLS ==========`)
    console.log(`[WEB-CHAT-FINAL] 🔧 Cantidad de tool calls: ${toolCalls.length}`)
    console.log(`[WEB-CHAT-FINAL] 🔑 Cliente ID a usar: "${clienteId}"`)

    const toolOutputs = []

    for (const toolCall of toolCalls) {
      console.log(`[WEB-CHAT-FINAL] ========== TOOL CALL ==========`)
      console.log(`[WEB-CHAT-FINAL] 🔧 Función: ${toolCall.function.name}`)
      console.log(`[WEB-CHAT-FINAL] 🔧 ID: ${toolCall.id}`)
      console.log(`[WEB-CHAT-FINAL] 🔧 Argumentos: ${toolCall.function.arguments}`)

      try {
        let output = ""
        const args = JSON.parse(toolCall.function.arguments)

        switch (toolCall.function.name) {
          case "validate_dni":
            console.log(`[WEB-CHAT-FINAL] 🔍 Validando DNI: "${args.dni}" para cliente: "${clienteId}"`)
            const dniResult = await validateDNI(args.dni, clienteId)
            console.log(`[WEB-CHAT-FINAL] 📊 Resultado DNI:`, dniResult)
            output = JSON.stringify(dniResult)
            break

          case "search_turnos":
            console.log(`[WEB-CHAT-FINAL] 🔍 Buscando turnos para cliente: "${clienteId}"`)
            console.log(`[WEB-CHAT-FINAL] 📊 Parámetros de búsqueda:`, args)

            // Asegurar que tenemos rangoFechas
            if (!args.rangoFechas) {
              console.log(`[WEB-CHAT-FINAL] ⚠️ No se proporcionó rangoFechas, usando valor por defecto`)
              const hoy = new Date().toISOString().split("T")[0]
              const mañana = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0]
              args.rangoFechas = `${hoy} a ${mañana}`
            }

            const turnosResult = await searchTurnos(args, clienteId)
            console.log(`[WEB-CHAT-FINAL] 📊 Resultado turnos:`, turnosResult)
            output = JSON.stringify(turnosResult)
            break

          default:
            console.log(`[WEB-CHAT-FINAL] ❌ Tool call no reconocido: ${toolCall.function.name}`)
            output = JSON.stringify({ error: "Función no disponible" })
        }

        console.log(`[WEB-CHAT-FINAL] ✅ Output generado: ${output.length} caracteres`)
        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: output,
        })
      } catch (error) {
        console.error(`[WEB-CHAT-FINAL] ❌ Error en tool call ${toolCall.function.name}:`, error)
        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: JSON.stringify({
            error: "Error procesando la solicitud",
            details: error instanceof Error ? error.message : String(error),
          }),
        })
      }
    }

    // Enviar tool outputs
    console.log(`[WEB-CHAT-FINAL] 📤 Enviando ${toolOutputs.length} tool outputs`)
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
      const errorText = await submitResponse.text()
      console.error(`[WEB-CHAT-FINAL] ❌ Error enviando tool outputs: ${submitResponse.status} ${errorText}`)
      throw new Error(`Error submitting tool outputs: ${submitResponse.status}`)
    }

    console.log(`[WEB-CHAT-FINAL] ✅ Tool outputs enviados correctamente`)
  } catch (error) {
    console.error("[WEB-CHAT-FINAL] ❌ Error en handleToolCalls:", error)
    throw error
  }
}
