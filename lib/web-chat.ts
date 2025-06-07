import { OpenAI } from "openai"
import { getThreadForUser, updateWhatsAppStats } from "@/lib/db"
import { getArgentinaDateTime } from "@/lib/utils/date-utils"
import { incrementMetric } from "@/lib/monitoring"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function processWebMessage(userMessage: string, sessionId: string, config: any): Promise<string> {
  try {
    console.log(`[WEB-CHAT] Procesando mensaje web para sesión ${sessionId}: "${userMessage}"`)

    // Incrementar métricas
    await incrementMetric("web_messages_received")

    // Actualizar estadísticas - mensaje recibido
    await updateWhatsAppStats(config.id, { messagesReceived: 1 })

    // Obtener o crear un thread para esta sesión
    const threadResult = await getThreadForUser(`web-${sessionId}`, config.id)
    console.log(`[WEB-CHAT] Thread obtenido: ${threadResult.threadId}, isNewThread: ${threadResult.isNewThread}`)

    // Preparar mensaje con parámetros iniciales
    const fechaHora = getArgentinaDateTime()
    let messageToSend = `[SISTEMA]
Nombre: ${config.displayName}
FechaHora: ${fechaHora}
PrimerMensaje: ${threadResult.isNewThread}
TipoMensaje: web
CanalOrigen: web
[/SISTEMA]

${userMessage}`

    // Si es un thread reseteado, indicarlo
    if (threadResult.isResetThread) {
      messageToSend = `[SISTEMA]
Nombre: ${config.displayName}
FechaHora: ${fechaHora}
PrimerMensaje: true
ThreadReseteado: true
TipoMensaje: web
CanalOrigen: web
[/SISTEMA]

${userMessage}`
    }

    console.log(`[WEB-CHAT] Mensaje preparado para OpenAI:`, messageToSend)

    // Añadir mensaje al thread
    await openai.beta.threads.messages.create(threadResult.threadId, {
      role: "user",
      content: messageToSend,
    })

    // Ejecutar el thread con el asistente
    const run = await openai.beta.threads.runs.create(threadResult.threadId, {
      assistant_id: config.assistantId,
    })

    // Esperar a que termine la ejecución
    const response = await waitForRunCompletion(threadResult.threadId, run.id)

    // Actualizar estadísticas - mensaje procesado
    await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
    await incrementMetric("web_messages_processed")

    return response
  } catch (error) {
    console.error("[WEB-CHAT] Error al procesar mensaje web:", error)

    // Actualizar estadísticas - error
    await updateWhatsAppStats(config.id, { errors: 1 })
    await incrementMetric("web_errors")

    throw error
  }
}

async function waitForRunCompletion(threadId: string, runId: string): Promise<string> {
  let runStatus = await openai.beta.threads.runs.retrieve(threadId, runId)

  // Esperar a que termine la ejecución
  while (runStatus.status === "queued" || runStatus.status === "in_progress") {
    // Esperar 1 segundo antes de verificar de nuevo
    await new Promise((resolve) => setTimeout(resolve, 1000))
    runStatus = await openai.beta.threads.runs.retrieve(threadId, runId)
  }

  // Verificar si la ejecución fue exitosa
  if (runStatus.status !== "completed") {
    console.error(`[WEB-CHAT] Error en la ejecución: ${runStatus.status}`)
    throw new Error(`Error en la ejecución: ${runStatus.status}`)
  }

  // Obtener los mensajes del thread
  const messages = await openai.beta.threads.messages.list(threadId)

  // Obtener el último mensaje del asistente
  const assistantMessages = messages.data.filter((msg) => msg.role === "assistant")

  if (assistantMessages.length === 0) {
    throw new Error("No se encontró respuesta del asistente")
  }

  // Obtener el contenido del último mensaje
  const lastMessage = assistantMessages[0]
  let responseText = ""

  if (lastMessage.content && lastMessage.content.length > 0) {
    const textContent = lastMessage.content.filter((content) => content.type === "text")
    if (textContent.length > 0) {
      responseText = textContent[0].text.value
    }
  }

  return responseText || "Lo siento, no pude generar una respuesta."
}
