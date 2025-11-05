import OpenAI from "openai"

// Inicializar el cliente de OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// Exportar la instancia para uso en otros módulos
export { openai }

// Tiempo máximo de espera para la ejecución del asistente (en milisegundos)
const MAX_WAIT_TIME = 30000 // 30 segundos
const POLLING_INTERVAL = 1000 // 1 segundo

// Función para obtener respuesta del asistente
export async function getAssistantResponse(
  threadId: string,
  message: string,
  assistantId: string = process.env.OPENAI_ASSISTANT_ID!,
): Promise<string> {
  try {
    // Añadir el mensaje del usuario al thread
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    })

    // Ejecutar el asistente
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    })

    // Esperar a que el asistente complete la ejecución
    const runStatus = await waitForRunCompletion(threadId, run.id)

    // Obtener los mensajes más recientes
    const messages = await openai.beta.threads.messages.list(threadId, {
      order: "desc",
      limit: 1,
    })

    // Obtener la respuesta del asistente
    const assistantMessage = messages.data.find((msg) => msg.role === "assistant")

    if (!assistantMessage) {
      throw new Error("No se encontró respuesta del asistente")
    }

    // Extraer el texto de la respuesta
    let responseText = ""
    for (const content of assistantMessage.content) {
      if (content.type === "text") {
        responseText += content.text.value
      }
    }

    return responseText
  } catch (error) {
    console.error("Error al obtener respuesta del asistente:", error)
    return "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta de nuevo más tarde."
  }
}

// Función para esperar a que se complete la ejecución del asistente
async function waitForRunCompletion(threadId: string, runId: string): Promise<OpenAI.Beta.Threads.Runs.Run> {
  const startTime = Date.now()

  while (Date.now() - startTime < MAX_WAIT_TIME) {
    const runStatus = await openai.beta.threads.runs.retrieve(threadId, runId)

    switch (runStatus.status) {
      case "completed":
        return runStatus

      case "failed":
        throw new Error(`Run failed: ${runStatus.last_error?.message || "Unknown error"}`)

      case "expired":
        throw new Error("La ejecución del asistente expiró")

      case "cancelled":
        throw new Error("La ejecución del asistente fue cancelada")

      case "requires_action":
        throw new Error(
          "El asistente está intentando usar herramientas. Por favor, desactiva las herramientas en la configuración del asistente.",
        )

      default:
        // Para estados como "queued", "in_progress", etc., seguimos esperando
        await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL))
    }
  }

  // Si llegamos aquí, significa que se agotó el tiempo de espera
  throw new Error("Se agotó el tiempo de espera para la respuesta del asistente")
}
