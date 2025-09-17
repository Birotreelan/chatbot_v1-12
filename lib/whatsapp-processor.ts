import {
  getWhatsAppConfig,
  getThreadForUser,
  updateWhatsAppStats,
  getOrCreateConversation,
  addMessageToConversation,
} from "./db"
import OpenAI from "openai"
import { createWhatsAppSystemBlock as createSystemBlock } from "./openai-tools"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

interface WhatsAppMessage {
  messaging_product: string
  metadata: {
    display_phone_number: string
    phone_number_id: string
  }
  contacts: Array<{
    profile: {
      name: string
    }
    wa_id: string
  }>
  messages: Array<{
    from: string
    id: string
    timestamp: string
    text: {
      body: string
    }
    type: string
  }>
}

// Función principal para procesar mensajes de WhatsApp
export async function processWhatsAppMessage(
  phoneNumber: string,
  message: string,
  userName: string,
  messageId: string,
  whatsappConfigId: string,
): Promise<string> {
  console.log("[WHATSAPP-PROCESSOR] ========== PROCESANDO MENSAJE WHATSAPP ==========")
  console.log(`[WHATSAPP-PROCESSOR] Teléfono: ${phoneNumber}`)
  console.log(`[WHATSAPP-PROCESSOR] Mensaje: ${message}`)
  console.log(`[WHATSAPP-PROCESSOR] Config ID: ${whatsappConfigId}`)
  console.log("[WHATSAPP-PROCESSOR] ================================================")

  try {
    // Obtener configuración
    const config = await getWhatsAppConfig(whatsappConfigId)
    if (!config) {
      throw new Error(`Configuración no encontrada: ${whatsappConfigId}`)
    }

    console.log(`[WHATSAPP-PROCESSOR] Cliente: ${config.displayName}`)
    console.log(`[WHATSAPP-PROCESSOR] Cliente ID: ${config.cliente_id}`)
    console.log(`[WHATSAPP-PROCESSOR] Sede ID: ${config.sede_id}`)

    // Obtener o crear thread
    const threadInfo = await getThreadForUser(phoneNumber, whatsappConfigId)
    console.log(
      `[WHATSAPP-PROCESSOR] 🌐 Usando thread: ${threadInfo.threadId} (nuevo: ${threadInfo.isNewThread}, reset: ${threadInfo.isResetThread})`,
    )

    // Verificar si hay runs activos en el thread antes de agregar mensaje
    await cancelActiveRuns(threadInfo.threadId)

    // Obtener o crear conversación
    const conversation = await getOrCreateConversation(
      phoneNumber,
      userName,
      whatsappConfigId,
      config.cliente_id || "",
      config.displayName,
      threadInfo.threadId,
    )

    // Agregar mensaje del usuario a la conversación
    await addMessageToConversation(conversation.id, "user", message, messageId)

    console.log("[WHATSAPP-PROCESSOR] ========== PROCESANDO CON OPENAI ==========")
    console.log(`[WHATSAPP-PROCESSOR] Thread ID: ${threadInfo.threadId}`)
    console.log(`[WHATSAPP-PROCESSOR] Assistant ID: ${config.whatsappAssistantId}`)
    console.log(`[WHATSAPP-PROCESSOR] Cliente ID: ${config.cliente_id}`)
    console.log("[WHATSAPP-PROCESSOR] ================================================")

    // Agregar mensaje al thread
    console.log(`[WHATSAPP-PROCESSOR] Añadiendo mensaje al thread: ${threadInfo.threadId}`)
    const threadMessage = await openai.beta.threads.messages.create(threadInfo.threadId, {
      role: "user",
      content: message,
    })
    console.log(`[WHATSAPP-PROCESSOR] Mensaje añadido: ${threadMessage.id}`)

    // Crear run con el assistant
    console.log(`[WHATSAPP-PROCESSOR] Creando run con assistant: ${config.whatsappAssistantId}`)

    let additionalInstructions = ""

    // Si es un thread nuevo o reseteado, agregar información del sistema
    if (threadInfo.isNewThread || threadInfo.isResetThread) {
      console.log("[WHATSAPP-PROCESSOR] 🔄 Thread nuevo/reseteado, agregando información del sistema")

      if (config.cliente_id && config.sede_id) {
        try {
          const systemBlock = await createSystemBlock(config.displayName, config.cliente_id, config.sede_id)
          additionalInstructions = systemBlock
          console.log("[WHATSAPP-PROCESSOR] ✅ Información del sistema agregada")
        } catch (error) {
          console.error("[WHATSAPP-PROCESSOR] ❌ Error obteniendo información del sistema:", error)
        }
      }
    }

    const run = await openai.beta.threads.runs.create(threadInfo.threadId, {
      assistant_id: config.whatsappAssistantId,
      additional_instructions: additionalInstructions || undefined,
    })
    console.log(`[WHATSAPP-PROCESSOR] Run creado: ${run.id}`)

    // Esperar a que se complete el run
    console.log("[WHATSAPP-PROCESSOR] ========== ESPERANDO COMPLETACIÓN ==========")
    console.log(`[WHATSAPP-PROCESSOR] Run ID: ${run.id}`)
    console.log(`[WHATSAPP-PROCESSOR] Cliente ID: ${config.cliente_id}`)
    console.log("[WHATSAPP-PROCESSOR] ================================================")

    const completedRun = await waitForRunCompletion(threadInfo.threadId, run.id, config.cliente_id)

    if (completedRun.status === "completed") {
      // Obtener los mensajes del thread
      const messages = await openai.beta.threads.messages.list(threadInfo.threadId, {
        order: "desc",
        limit: 1,
      })

      if (messages.data.length > 0) {
        const lastMessage = messages.data[0]
        if (lastMessage.role === "assistant" && lastMessage.content[0]?.type === "text") {
          const response = lastMessage.content[0].text.value
          console.log(`[WHATSAPP-PROCESSOR] ✅ Respuesta generada: ${response.length} caracteres`)

          // Agregar respuesta del asistente a la conversación
          await addMessageToConversation(conversation.id, "assistant", response, lastMessage.id)

          // Actualizar estadísticas
          await updateWhatsAppStats(whatsappConfigId, { messagesProcessed: 1 })

          return response
        }
      }
    }

    throw new Error(`Run no completado correctamente: ${completedRun.status}`)
  } catch (error) {
    console.error("[WHATSAPP-PROCESSOR] ❌ Error al procesar mensaje:", error)

    // Actualizar estadísticas de error
    await updateWhatsAppStats(whatsappConfigId, { errors: 1 })

    throw error
  }
}

// Función para cancelar runs activos
async function cancelActiveRuns(threadId: string): Promise<void> {
  try {
    console.log(`[WHATSAPP-PROCESSOR] 🔍 Verificando runs activos en thread: ${threadId}`)

    const runs = await openai.beta.threads.runs.list(threadId, {
      limit: 10,
      order: "desc",
    })

    for (const run of runs.data) {
      if (run.status === "in_progress" || run.status === "queued") {
        console.log(`[WHATSAPP-PROCESSOR] ⏹️ Cancelando run activo: ${run.id} (${run.status})`)
        try {
          await openai.beta.threads.runs.cancel(threadId, run.id)
          console.log(`[WHATSAPP-PROCESSOR] ✅ Run ${run.id} cancelado`)
        } catch (cancelError) {
          console.error(`[WHATSAPP-PROCESSOR] ❌ Error cancelando run ${run.id}:`, cancelError)
        }
      }
    }
  } catch (error) {
    console.error(`[WHATSAPP-PROCESSOR] ❌ Error verificando runs activos:`, error)
  }
}

async function waitForRunCompletion(
  threadId: string,
  runId: string,
  clienteId?: string,
  maxAttempts = 60,
): Promise<any> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[WHATSAPP-PROCESSOR] Verificando run ${runId} (intento ${attempt}/${maxAttempts})`)

      // CORREGIDO: Parámetros en el orden correcto (threadId, runId)
      const run = await openai.beta.threads.runs.retrieve(threadId, runId)

      if (run.status === "completed") {
        console.log(`[WHATSAPP-PROCESSOR] ✅ Run completado exitosamente`)
        return run
      }

      if (run.status === "failed" || run.status === "cancelled" || run.status === "expired") {
        console.error(`[WHATSAPP-PROCESSOR] ❌ Run falló con estado: ${run.status}`)
        throw new Error(`Run falló: ${run.status}`)
      }

      if (run.status === "requires_action" && run.required_action?.type === "submit_tool_outputs") {
        console.log(`[WHATSAPP-PROCESSOR] 🔧 Run requiere acción de herramientas`)

        const toolCalls = run.required_action.submit_tool_outputs.tool_calls
        const toolOutputs = []

        for (const toolCall of toolCalls) {
          console.log(`[WHATSAPP-PROCESSOR] 🛠️ Ejecutando herramienta: ${toolCall.function.name}`)

          try {
            let output = ""

            if (toolCall.function.name === "getSedes" && clienteId) {
              const { getSedes } = await import("./api-tools/api-functions")
              const args = JSON.parse(toolCall.function.arguments)
              const result = await getSedes(clienteId, args.sede_id)
              output = JSON.stringify(result)
            } else if (toolCall.function.name === "getTurnos" && clienteId) {
              const { getTurnos } = await import("./api-tools/api-functions")
              const args = JSON.parse(toolCall.function.arguments)
              const result = await getTurnos(clienteId, args.sede_id, args.fecha_desde, args.fecha_hasta)
              output = JSON.stringify(result)
            } else if (toolCall.function.name === "crearTurno" && clienteId) {
              const { crearTurno } = await import("./api-tools/api-functions")
              const args = JSON.parse(toolCall.function.arguments)
              const result = await crearTurno(clienteId, args)
              output = JSON.stringify(result)
            } else if (toolCall.function.name === "buscarPaciente" && clienteId) {
              const { buscarPaciente } = await import("./api-tools/api-functions")
              const args = JSON.parse(toolCall.function.arguments)
              const result = await buscarPaciente(clienteId, args.dni)
              output = JSON.stringify(result)
            } else {
              output = JSON.stringify({ error: "Función no disponible o cliente no configurado" })
            }

            toolOutputs.push({
              tool_call_id: toolCall.id,
              output: output,
            })

            console.log(`[WHATSAPP-PROCESSOR] ✅ Herramienta ${toolCall.function.name} ejecutada`)
          } catch (toolError) {
            console.error(`[WHATSAPP-PROCESSOR] ❌ Error ejecutando herramienta ${toolCall.function.name}:`, toolError)
            toolOutputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify({ error: "Error ejecutando herramienta" }),
            })
          }
        }

        // Enviar los outputs de las herramientas
        console.log(`[WHATSAPP-PROCESSOR] 📤 Enviando outputs de herramientas`)
        await openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
          tool_outputs: toolOutputs,
        })

        console.log(`[WHATSAPP-PROCESSOR] ✅ Outputs enviados, continuando...`)
      }

      // Esperar antes del siguiente intento
      await new Promise((resolve) => setTimeout(resolve, 2000))
    } catch (error) {
      console.error(`[WHATSAPP-PROCESSOR] ❌ Error al verificar run:`, error)

      if (attempt === maxAttempts) {
        throw error
      }

      // Esperar antes de reintentar
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }

  throw new Error(`Timeout esperando completación del run después de ${maxAttempts} intentos`)
}
