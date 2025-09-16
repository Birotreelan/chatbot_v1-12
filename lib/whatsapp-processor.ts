import { getSedes } from "./clinic-api"
import { getArgentinaDateTime } from "./utils/date-utils"
import { getThreadForUser } from "./db"
import { sendWhatsAppMessage } from "./whatsapp"
import { logError, incrementMetric } from "./monitoring"
import OpenAI from "openai"
import { getWhatsAppConfig, getOrCreateThread, addMessageToThread, runAssistant } from "./some-module" // Placeholder for actual imports

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

interface ProcessWhatsAppMessageParams {
  message: string
  phoneNumber: string
  config: any
  userName?: string
}

interface ProcessMessageParams {
  userPhone: string
  userName: string
  message: string
  phoneNumberId: string
}

// Función para crear el bloque [SISTEMA] para WhatsApp con datos de sedes
async function createWhatsAppSystemBlock(
  clinicName: string,
  phoneNumber: string,
  clienteId?: string,
  sedeId?: string,
): Promise<string> {
  const fechaHora = getArgentinaDateTime()

  let sedesInfo = "No disponible"

  // Obtener datos de sedes si tenemos clienteId
  if (clienteId) {
    try {
      console.log(`[WHATSAPP-PROCESSOR] 🏥 Obteniendo datos de sedes para cliente: ${clienteId}`)
      const sedesResult = await getSedes(clienteId)

      if (sedesResult.success && sedesResult.data) {
        // Formatear los datos de sedes para el bloque [SISTEMA]
        if (Array.isArray(sedesResult.data)) {
          sedesInfo = sedesResult.data
            .map(
              (sede: any) =>
                `ID: ${sede.Id || sede.id}, Nombre: ${sede.Nombre || sede.nombre || "Sin nombre"}, Direccion: ${sede.Direccion || sede.direccion || "Sin dirección"}`,
            )
            .join(" | ")
        } else if (sedesResult.data.sedes && Array.isArray(sedesResult.data.sedes)) {
          sedesInfo = sedesResult.data.sedes
            .map(
              (sede: any) =>
                `ID: ${sede.Id || sede.id}, Nombre: ${sede.Nombre || sede.nombre || "Sin nombre"}, Direccion: ${sede.Direccion || sede.direccion || "Sin dirección"}`,
            )
            .join(" | ")
        } else {
          sedesInfo = JSON.stringify(sedesResult.data).substring(0, 200) + "..."
        }
        console.log(`[WHATSAPP-PROCESSOR] ✅ Sedes obtenidas y formateadas`)
      } else {
        console.log(`[WHATSAPP-PROCESSOR] ⚠️ No se pudieron obtener sedes: ${sedesResult.error}`)
        sedesInfo = `Error: ${sedesResult.error}`
      }
    } catch (error) {
      console.error(`[WHATSAPP-PROCESSOR] ❌ Error obteniendo sedes:`, error)
      sedesInfo = "Error al obtener sedes"
    }
  }

  return `[SISTEMA]
Nombre: ${clinicName}
FechaHora: ${fechaHora}
CelularPaciente: ${phoneNumber}
Cliente_id: ${clienteId || "No configurado"}
sede_id: ${sedeId || "No configurado"}
Sedes_Disponibles: ${sedesInfo}
[/SISTEMA]`
}

export async function processWhatsAppMessage({
  phoneNumber,
  message,
  config,
  userName = "Usuario",
}: ProcessWhatsAppMessageParams): Promise<void> {
  console.log(`[WHATSAPP-PROCESSOR] 🚀 Iniciando procesamiento para ${phoneNumber}`)

  try {
    // Obtener o crear thread
    const { threadId, isNewThread, isResetThread } = await getThreadForUser(phoneNumber, config.id)
    console.log(`[WHATSAPP-PROCESSOR] 🧵 Thread: ${threadId} (nuevo: ${isNewThread}, reset: ${isResetThread})`)

    // Agregar mensaje al thread
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    })

    console.log(`[WHATSAPP-PROCESSOR] 💬 Mensaje agregado al thread`)

    // Crear y ejecutar run
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: config.whatsappAssistantId,
      timeout: 60000, // 60 segundos de timeout
    })

    console.log(`[WHATSAPP-PROCESSOR] ⚡ Run creado: ${run.id}`)

    // Esperar a que el run se complete
    let runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id)
    let attempts = 0
    const maxAttempts = 30 // 30 intentos = 60 segundos máximo

    while (runStatus.status === "in_progress" || runStatus.status === "queued") {
      if (attempts >= maxAttempts) {
        throw new Error("Timeout esperando respuesta del asistente")
      }

      await new Promise((resolve) => setTimeout(resolve, 2000)) // Esperar 2 segundos
      runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id)
      attempts++

      console.log(`[WHATSAPP-PROCESSOR] ⏳ Estado del run: ${runStatus.status} (intento ${attempts}/${maxAttempts})`)
    }

    if (runStatus.status === "completed") {
      // Obtener la respuesta
      const messages = await openai.beta.threads.messages.list(threadId, {
        order: "desc",
        limit: 1,
      })

      if (messages.data.length > 0) {
        const assistantMessage = messages.data[0]
        if (assistantMessage.role === "assistant" && assistantMessage.content[0].type === "text") {
          const responseText = assistantMessage.content[0].text.value
          console.log(`[WHATSAPP-PROCESSOR] 🤖 Respuesta del asistente: "${responseText}"`)

          // Enviar respuesta por WhatsApp
          const sent = await sendWhatsAppMessage(phoneNumber, responseText, config)

          if (sent) {
            console.log(`[WHATSAPP-PROCESSOR] ✅ Respuesta enviada exitosamente`)
            await incrementMetric("messages_processed")
          } else {
            console.error(`[WHATSAPP-PROCESSOR] ❌ Error enviando respuesta`)
            await incrementMetric("message_send_errors")
          }
        }
      }
    } else if (runStatus.status === "requires_action") {
      console.log(`[WHATSAPP-PROCESSOR] 🔧 Run requiere acción: ${runStatus.required_action?.type}`)

      if (runStatus.required_action?.type === "submit_tool_outputs") {
        const toolCalls = runStatus.required_action.submit_tool_outputs.tool_calls
        console.log(`[WHATSAPP-PROCESSOR] 🛠️ Procesando ${toolCalls.length} tool calls`)

        const toolOutputs = []

        for (const toolCall of toolCalls) {
          console.log(`[WHATSAPP-PROCESSOR] 🔨 Ejecutando tool: ${toolCall.function.name}`)

          try {
            // Aquí puedes agregar la lógica para manejar diferentes tools
            // Por ahora, devolvemos un resultado genérico
            const result = await handleToolCall(toolCall, config)

            toolOutputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify(result),
            })
          } catch (toolError) {
            console.error(`[WHATSAPP-PROCESSOR] ❌ Error ejecutando tool ${toolCall.function.name}:`, toolError)
            toolOutputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify({ error: "Error ejecutando la función" }),
            })
          }
        }

        // Enviar los resultados de los tools
        await openai.beta.threads.runs.submitToolOutputs(threadId, run.id, {
          tool_outputs: toolOutputs,
        })

        // Esperar a que se complete después de enviar los tool outputs
        let finalRunStatus = await openai.beta.threads.runs.retrieve(threadId, run.id)
        attempts = 0

        while (finalRunStatus.status === "in_progress" || finalRunStatus.status === "queued") {
          if (attempts >= maxAttempts) {
            throw new Error("Timeout esperando respuesta después de tool outputs")
          }

          await new Promise((resolve) => setTimeout(resolve, 2000))
          finalRunStatus = await openai.beta.threads.runs.retrieve(threadId, run.id)
          attempts++
        }

        if (finalRunStatus.status === "completed") {
          // Obtener la respuesta final
          const finalMessages = await openai.beta.threads.messages.list(threadId, {
            order: "desc",
            limit: 1,
          })

          if (finalMessages.data.length > 0) {
            const assistantMessage = finalMessages.data[0]
            if (assistantMessage.role === "assistant" && assistantMessage.content[0].type === "text") {
              const responseText = assistantMessage.content[0].text.value
              console.log(`[WHATSAPP-PROCESSOR] 🤖 Respuesta final del asistente: "${responseText}"`)

              const sent = await sendWhatsAppMessage(phoneNumber, responseText, config)

              if (sent) {
                console.log(`[WHATSAPP-PROCESSOR] ✅ Respuesta final enviada exitosamente`)
                await incrementMetric("messages_processed")
              }
            }
          }
        }
      }
    } else if (runStatus.status === "failed") {
      console.error(`[WHATSAPP-PROCESSOR] ❌ Run falló:`, runStatus.last_error)

      // Enviar mensaje de error al usuario
      const errorMessage = "Lo siento, hubo un problema procesando tu mensaje. Por favor, intenta nuevamente."
      await sendWhatsAppMessage(phoneNumber, errorMessage, config)

      await logError("openai_run_failed", new Error(`Run failed: ${runStatus.last_error?.message}`))
      await incrementMetric("processing_errors")
    } else {
      console.error(`[WHATSAPP-PROCESSOR] ❌ Estado inesperado del run: ${runStatus.status}`)

      // Enviar mensaje de error al usuario
      const errorMessage = "Lo siento, hubo un problema procesando tu mensaje. Por favor, intenta nuevamente."
      await sendWhatsAppMessage(phoneNumber, errorMessage, config)

      await incrementMetric("processing_errors")
    }
  } catch (error) {
    console.error(`[WHATSAPP-PROCESSOR] ❌ Error procesando mensaje:`, error)

    // Enviar mensaje de error al usuario
    const errorMessage = "Lo siento, hubo un problema procesando tu mensaje. Por favor, intenta nuevamente."
    try {
      await sendWhatsAppMessage(phoneNumber, errorMessage, config)
    } catch (sendError) {
      console.error(`[WHATSAPP-PROCESSOR] ❌ Error enviando mensaje de error:`, sendError)
    }

    await logError("whatsapp_processing", error instanceof Error ? error : new Error(String(error)))
    await incrementMetric("processing_errors")

    throw error
  }
}

// Función para manejar tool calls
async function handleToolCall(toolCall: any, config: any): Promise<any> {
  const functionName = toolCall.function.name
  const functionArgs = JSON.parse(toolCall.function.arguments)

  console.log(`[WHATSAPP-PROCESSOR] 🔧 Ejecutando función: ${functionName}`)
  console.log(`[WHATSAPP-PROCESSOR] 📋 Argumentos:`, functionArgs)

  // Aquí puedes agregar la lógica para diferentes funciones
  switch (functionName) {
    case "get_current_time":
      return {
        time: new Date().toLocaleString("es-AR", {
          timeZone: "America/Argentina/Buenos_Aires",
        }),
      }

    case "get_weather":
      return {
        weather: "Soleado, 22°C",
        location: functionArgs.location || "Buenos Aires",
      }

    default:
      console.log(`[WHATSAPP-PROCESSOR] ⚠️ Función no implementada: ${functionName}`)
      return {
        error: `Función ${functionName} no está implementada`,
      }
  }
}

export async function processMessage({
  userPhone,
  userName,
  message,
  phoneNumberId,
}: ProcessMessageParams): Promise<string | null> {
  console.log(`[PROCESSOR] 🚀 Iniciando procesamiento para ${userName}`)

  try {
    // Obtener configuración de WhatsApp
    const config = await getWhatsAppConfig(phoneNumberId)
    if (!config) {
      console.error(`[PROCESSOR] ❌ No se encontró configuración para ${phoneNumberId}`)
      return "Lo siento, hay un problema de configuración. Por favor contacta al administrador."
    }

    console.log(`[PROCESSOR] ⚙️ Usando asistente: ${config.assistantId}`)

    // Obtener o crear thread para el usuario
    const threadId = await getOrCreateThread(userPhone)
    console.log(`[PROCESSOR] 🧵 Thread ID: ${threadId}`)

    // Agregar mensaje del usuario al thread
    await addMessageToThread(threadId, message)
    console.log(`[PROCESSOR] ✅ Mensaje agregado al thread`)

    // Ejecutar el asistente
    console.log(`[PROCESSOR] 🤖 Ejecutando asistente...`)
    const response = await runAssistant(threadId, config.assistantId)

    if (response) {
      console.log(`[PROCESSOR] ✅ Respuesta generada: "${response.substring(0, 100)}..."`)
      return response
    } else {
      console.log(`[PROCESSOR] ⚠️ No se obtuvo respuesta del asistente`)
      return "Lo siento, no pude procesar tu mensaje en este momento. Por favor intenta de nuevo."
    }
  } catch (error) {
    console.error(`[PROCESSOR] ❌ Error procesando mensaje:`, error)

    // Respuesta de error amigable
    if (error instanceof Error) {
      if (error.message.includes("timeout")) {
        return "Lo siento, el procesamiento está tomando más tiempo del esperado. Por favor intenta de nuevo."
      } else if (error.message.includes("rate limit")) {
        return "Estoy recibiendo muchos mensajes. Por favor espera un momento antes de enviar otro mensaje."
      }
    }

    return "Lo siento, ocurrió un error procesando tu mensaje. Por favor intenta de nuevo más tarde."
  }
}
