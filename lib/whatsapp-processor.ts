import { openai } from "./openai"
import { getThreadForUser, resetThreadForUser, updateWhatsAppStats } from "./db"
import { sendWhatsAppMessage } from "./whatsapp-api"
import { getSedes, getTurnos, getDni, createTurno } from "./api-tools/api-functions"
import { createWhatsAppSystemBlock } from "./openai-tools"
import type { WhatsAppConfig } from "./types"

const MAX_RETRIES = 3
const RETRY_DELAY = 2000 // 2 segundos

interface ProcessMessageParams {
  phoneNumber: string
  message: string
  userName: string
  config: WhatsAppConfig
}

export async function processWhatsAppMessage({
  phoneNumber,
  message,
  userName,
  config,
}: ProcessMessageParams): Promise<void> {
  console.log(`[WHATSAPP-PROCESSOR] ========== PROCESANDO MENSAJE WHATSAPP ==========`)
  console.log(`[WHATSAPP-PROCESSOR] Teléfono: ${phoneNumber}`)
  console.log(`[WHATSAPP-PROCESSOR] Cliente: ${config.displayName}`)
  console.log(`[WHATSAPP-PROCESSOR] Cliente ID: ${config.cliente_id}`)
  console.log(`[WHATSAPP-PROCESSOR] Sede ID: ${config.sede_id}`)
  console.log(`[WHATSAPP-PROCESSOR] Mensaje: ${message}`)
  console.log(`[WHATSAPP-PROCESSOR] ================================================`)

  try {
    // 1. VERIFICAR COMANDO ESPECIAL "tree reset"
    if (message.toLowerCase().trim() === "tree reset") {
      console.log(`[WHATSAPP-PROCESSOR] 🔄 COMANDO TREE RESET DETECTADO`)

      try {
        // Resetear el thread
        const { threadId } = await resetThreadForUser(phoneNumber, config.id)
        console.log(`[WHATSAPP-PROCESSOR] ✅ Thread reseteado exitosamente: ${threadId}`)

        // Enviar mensaje de confirmación
        await sendWhatsAppMessage(
          phoneNumber,
          "🔄 *Conversación reiniciada*\n\nHe reiniciado nuestra conversación. Puedes empezar de nuevo.\n\n¿En qué puedo ayudarte?",
          config.accessToken,
          config.phoneNumberId,
        )

        console.log(`[WHATSAPP-PROCESSOR] ✅ Mensaje de confirmación enviado`)
        return
      } catch (error) {
        console.error(`[WHATSAPP-PROCESSOR] ❌ Error al resetear thread:`, error)

        // Enviar mensaje de error
        await sendWhatsAppMessage(
          phoneNumber,
          "❌ Hubo un error al reiniciar la conversación. Por favor, intenta de nuevo.",
          config.accessToken,
          config.phoneNumberId,
        )
        return
      }
    }

    // 2. OBTENER O CREAR THREAD
    const { threadId, isNewThread, isResetThread } = await getThreadForUser(phoneNumber, config.id)
    console.log(`[WHATSAPP-PROCESSOR] 🌐 Usando thread: ${threadId} (nuevo: ${isNewThread}, reset: ${isResetThread})`)

    // 3. OBTENER DATOS DE SEDES (si están configurados)
    let sedesData = null
    if (config.cliente_id) {
      console.log(`[WHATSAPP-PROCESSOR] 🏥 Obteniendo datos de sedes para cliente: ${config.cliente_id}`)
      try {
        sedesData = await getSedes(config.cliente_id, config.sede_id)
        if (sedesData && !sedesData.error) {
          console.log(`[WHATSAPP-PROCESSOR] ✅ Datos de sedes obtenidos exitosamente`)
        } else {
          console.log(`[WHATSAPP-PROCESSOR] ⚠️ No se pudieron obtener sedes:`, sedesData?.mensaje || "Error desconocido")
        }
      } catch (error) {
        console.error(`[WHATSAPP-PROCESSOR] ❌ Error al obtener sedes:`, error)
      }
    }

    // 4. CREAR BLOQUE DEL SISTEMA
    const systemBlock = createWhatsAppSystemBlock({
      clienteId: config.cliente_id,
      sedeId: config.sede_id,
      sedesData,
      isNewThread: isNewThread || isResetThread,
      userName,
    })

    console.log(`[WHATSAPP-PROCESSOR] 📋 Bloque [SISTEMA] creado`)

    // 5. PROCESAR CON OPENAI
    const response = await processWithOpenAI({
      threadId,
      message,
      systemBlock,
      assistantId: config.whatsappAssistantId,
      clienteId: config.cliente_id || "",
    })

    // 6. ENVIAR RESPUESTA
    if (response) {
      await sendWhatsAppMessage(phoneNumber, response, config.accessToken, config.phoneNumberId)
      console.log(`[WHATSAPP-PROCESSOR] ✅ Respuesta enviada exitosamente`)

      // Actualizar estadísticas
      await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
    } else {
      console.error(`[WHATSAPP-PROCESSOR] ❌ No se obtuvo respuesta del asistente`)
      await updateWhatsAppStats(config.id, { errors: 1 })
    }
  } catch (error) {
    console.error(`[WHATSAPP-PROCESSOR] ❌ ERROR CRÍTICO:`, error)

    // Actualizar estadísticas de error
    await updateWhatsAppStats(config.id, { errors: 1 })

    // Enviar mensaje de error al usuario
    try {
      await sendWhatsAppMessage(
        phoneNumber,
        "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta de nuevo más tarde.",
        config.accessToken,
        config.phoneNumberId,
      )
    } catch (sendError) {
      console.error(`[WHATSAPP-PROCESSOR] ❌ Error al enviar mensaje de error:`, sendError)
    }
  }
}

async function processWithOpenAI({
  threadId,
  message,
  systemBlock,
  assistantId,
  clienteId,
}: {
  threadId: string
  message: string
  systemBlock: string
  assistantId: string
  clienteId: string
}): Promise<string | null> {
  console.log(`[WHATSAPP-PROCESSOR] ========== PROCESANDO CON OPENAI ==========`)
  console.log(`[WHATSAPP-PROCESSOR] Thread ID: ${threadId}`)
  console.log(`[WHATSAPP-PROCESSOR] Assistant ID: ${assistantId}`)
  console.log(`[WHATSAPP-PROCESSOR] Cliente ID: ${clienteId}`)
  console.log(`[WHATSAPP-PROCESSOR] ================================================`)

  try {
    // 1. AÑADIR MENSAJE AL THREAD
    console.log(`[WHATSAPP-PROCESSOR] Añadiendo mensaje al thread: ${threadId}`)
    const userMessage = await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: `${systemBlock}\n\n[USUARIO]: ${message}`,
    })
    console.log(`[WHATSAPP-PROCESSOR] Mensaje añadido: ${userMessage.id}`)

    // 2. CREAR RUN
    console.log(`[WHATSAPP-PROCESSOR] Creando run con assistant: ${assistantId}`)
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    })
    console.log(`[WHATSAPP-PROCESSOR] Run creado: ${run.id}`)

    // 3. ESPERAR COMPLETACIÓN CON REINTENTOS
    const completedRun = await waitForRunCompletion(threadId, run.id, clienteId)

    // 4. OBTENER RESPUESTA
    const messages = await openai.beta.threads.messages.list(threadId, {
      order: "desc",
      limit: 1,
    })

    const assistantMessage = messages.data.find((msg) => msg.role === "assistant")
    if (!assistantMessage) {
      throw new Error("No se encontró respuesta del asistente")
    }

    // 5. EXTRAER TEXTO
    let responseText = ""
    for (const content of assistantMessage.content) {
      if (content.type === "text") {
        responseText += content.text.value
      }
    }

    console.log(`[WHATSAPP-PROCESSOR] ✅ Respuesta obtenida: ${responseText.substring(0, 100)}...`)
    return responseText
  } catch (error) {
    console.error(`[WHATSAPP-PROCESSOR] ❌ Error en procesamiento OpenAI:`, error)
    return null
  }
}

async function waitForRunCompletion(
  threadId: string,
  runId: string,
  clienteId: string,
  maxAttempts = 60,
): Promise<any> {
  console.log(`[WHATSAPP-PROCESSOR] ========== ESPERANDO COMPLETACIÓN ==========`)
  console.log(`[WHATSAPP-PROCESSOR] Run ID: ${runId}`)
  console.log(`[WHATSAPP-PROCESSOR] Cliente ID: ${clienteId}`)
  console.log(`[WHATSAPP-PROCESSOR] ================================================`)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[WHATSAPP-PROCESSOR] Verificando run ${runId} (intento ${attempt}/${maxAttempts})`)

      const run = await openai.beta.threads.runs.retrieve(threadId, runId)
      console.log(`[WHATSAPP-PROCESSOR] Estado del run: ${run.status}`)

      switch (run.status) {
        case "completed":
          console.log(`[WHATSAPP-PROCESSOR] ✅ Run completado exitosamente`)
          return run

        case "failed":
          const errorMessage = run.last_error?.message || "Error desconocido"
          console.error(`[WHATSAPP-PROCESSOR] ❌ Run falló: ${errorMessage}`)
          throw new Error(`Run failed: ${errorMessage}`)

        case "expired":
          console.error(`[WHATSAPP-PROCESSOR] ❌ Run expiró`)
          throw new Error("Run expired")

        case "cancelled":
          console.error(`[WHATSAPP-PROCESSOR] ❌ Run cancelado`)
          throw new Error("Run cancelled")

        case "requires_action":
          console.log(`[WHATSAPP-PROCESSOR] 🔧 Run requiere acción: ${run.required_action?.type}`)

          if (run.required_action?.type === "submit_tool_outputs") {
            const toolCalls = run.required_action.submit_tool_outputs.tool_calls
            console.log(`[WHATSAPP-PROCESSOR] 🛠️ Procesando ${toolCalls.length} llamadas de herramientas`)

            const toolOutputs = await Promise.all(
              toolCalls.map(async (toolCall) => {
                console.log(`[WHATSAPP-PROCESSOR] 🔧 Ejecutando herramienta: ${toolCall.function.name}`)

                try {
                  const result = await executeToolCall(toolCall, clienteId)
                  console.log(`[WHATSAPP-PROCESSOR] ✅ Herramienta ejecutada: ${toolCall.function.name}`)

                  return {
                    tool_call_id: toolCall.id,
                    output: JSON.stringify(result),
                  }
                } catch (toolError) {
                  console.error(`[WHATSAPP-PROCESSOR] ❌ Error en herramienta ${toolCall.function.name}:`, toolError)

                  return {
                    tool_call_id: toolCall.id,
                    output: JSON.stringify({
                      error: "Error al ejecutar la herramienta",
                      details: toolError instanceof Error ? toolError.message : "Error desconocido",
                    }),
                  }
                }
              }),
            )

            // Enviar resultados de herramientas
            console.log(`[WHATSAPP-PROCESSOR] 📤 Enviando resultados de herramientas`)
            await openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
              tool_outputs: toolOutputs,
            })

            console.log(`[WHATSAPP-PROCESSOR] ✅ Resultados enviados, continuando...`)
          }
          break

        case "queued":
        case "in_progress":
          console.log(`[WHATSAPP-PROCESSOR] ⏳ Run en progreso, esperando...`)
          break

        default:
          console.log(`[WHATSAPP-PROCESSOR] ❓ Estado desconocido: ${run.status}`)
      }

      // Esperar antes del siguiente intento
      await new Promise((resolve) => setTimeout(resolve, 2000))
    } catch (error) {
      console.error(`[WHATSAPP-PROCESSOR] ❌ Error en intento ${attempt}:`, error)

      if (attempt === maxAttempts) {
        throw error
      }

      // Esperar antes de reintentar
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY))
    }
  }

  throw new Error(`Timeout: Run no completado después de ${maxAttempts} intentos`)
}

async function executeToolCall(toolCall: any, clienteId: string): Promise<any> {
  const functionName = toolCall.function.name
  const args = JSON.parse(toolCall.function.arguments)

  console.log(`[WHATSAPP-PROCESSOR] 🔧 Ejecutando: ${functionName}`)
  console.log(`[WHATSAPP-PROCESSOR] 📋 Argumentos:`, args)

  switch (functionName) {
    case "get_sedes":
      return await getSedes(clienteId, args.sede_id)

    case "get_turnos":
      return await getTurnos(clienteId, args.sede_id, args.fecha)

    case "get_dni":
      return await getDni(args.dni)

    case "create_turno":
      return await createTurno(
        clienteId,
        args.sede_id,
        args.fecha,
        args.hora,
        args.dni,
        args.nombre,
        args.apellido,
        args.telefono,
        args.email,
      )

    default:
      console.error(`[WHATSAPP-PROCESSOR] ❌ Función desconocida: ${functionName}`)
      return {
        error: "Función no reconocida",
        function: functionName,
      }
  }
}
